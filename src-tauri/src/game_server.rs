use crate::{distribution::safe_relative_path, error::AppError};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tiny_http::{Header, Method, Request, Response, Server};
use uuid::Uuid;

const GAME_SERVER_ADDRESS: &str = "127.0.0.1:17420";

pub struct GameServer {
    #[cfg(desktop)]
    base_url: String,
    port: u16,
    token: String,
    server: Arc<Server>,
    running: Arc<AtomicBool>,
}

impl GameServer {
    pub fn start(root: PathBuf) -> Result<Self, AppError> {
        Self::start_at(root, GAME_SERVER_ADDRESS)
    }

    fn start_at(root: PathBuf, bind_address: &str) -> Result<Self, AppError> {
        let server = Arc::new(
            Server::http(bind_address)
                .map_err(|error| AppError::Runtime(format!("serveur local: {error}")))?,
        );
        let address = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| AppError::Runtime("adresse du serveur local invalide".into()))?;
        let token = Uuid::new_v4().simple().to_string();
        #[cfg(desktop)]
        let base_url = format!("http://127.0.0.1:{}/{token}", address.port());
        let running = Arc::new(AtomicBool::new(true));
        let thread_server = Arc::clone(&server);
        let thread_running = Arc::clone(&running);
        let thread_token = token.clone();
        thread::Builder::new()
            .name("twelia-game-server".into())
            .spawn(move || {
                while thread_running.load(Ordering::Acquire) {
                    match thread_server.recv_timeout(Duration::from_millis(500)) {
                        Ok(Some(request)) => serve(request, &root, &thread_token),
                        Ok(None) => {}
                        Err(error) if thread_running.load(Ordering::Acquire) => {
                            log::warn!("serveur du client: {error}");
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|error| AppError::Runtime(format!("thread serveur local: {error}")))?;
        Ok(Self {
            #[cfg(desktop)]
            base_url,
            port: address.port(),
            token,
            server,
            running,
        })
    }

    #[cfg(desktop)]
    pub fn index_url(&self) -> String {
        format!("{}/index.html", self.base_url)
    }

    pub fn isolated_index_url(&self, profile_id: &str) -> Result<String, AppError> {
        if profile_id.is_empty()
            || profile_id.len() > 48
            || !profile_id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err(AppError::InvalidInput(
                "identifiant de profil invalide".into(),
            ));
        }
        Ok(format!(
            "http://profile-{}.localhost:{}/{}/index.html",
            profile_id.to_ascii_lowercase(),
            self.port,
            self.token
        ))
    }
}

impl Drop for GameServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.server.unblock();
    }
}

fn serve(request: Request, root: &Path, token: &str) {
    if !matches!(request.method(), Method::Get | Method::Head) {
        let _ = request.respond(Response::empty(405));
        return;
    }
    let path_only = request.url().split('?').next().unwrap_or_default();
    let expected_prefix = format!("/{token}/");
    let Some(relative_url) = path_only.strip_prefix(&expected_prefix) else {
        let _ = request.respond(Response::empty(404));
        return;
    };
    if relative_url.contains('%') || relative_url.contains('\\') {
        let _ = request.respond(Response::empty(400));
        return;
    }
    let relative = match safe_relative_path(relative_url) {
        Ok(path) => path,
        Err(_) => {
            let _ = request.respond(Response::empty(400));
            return;
        }
    };
    let absolute = root.join(relative);
    if !absolute.is_file() {
        let _ = request.respond(Response::empty(404));
        return;
    }

    let content_type = mime_guess::from_path(&absolute).first_or_octet_stream();
    let content_type = Header::from_bytes("Content-Type", content_type.as_ref()).unwrap();
    let cache = Header::from_bytes("Cache-Control", "no-cache").unwrap();
    let no_sniff = Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap();
    if request.method() == &Method::Head {
        let _ = request.respond(
            Response::empty(200)
                .with_header(content_type)
                .with_header(cache)
                .with_header(no_sniff),
        );
        return;
    }
    match fs::File::open(&absolute) {
        Ok(file) => {
            let _ = request.respond(
                Response::from_file(file)
                    .with_header(content_type)
                    .with_header(cache)
                    .with_header(no_sniff),
            );
        }
        Err(_) => {
            let _ = request.respond(Response::empty(500));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_loopback_only_url() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("index.html"), "ready").unwrap();
        let server = GameServer::start_at(root.path().to_path_buf(), "127.0.0.1:0").unwrap();
        assert!(server.index_url().starts_with("http://127.0.0.1:"));
        assert!(server.index_url().ends_with("/index.html"));
    }

    #[test]
    fn creates_a_distinct_local_origin_for_each_session() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("index.html"), "ready").unwrap();
        let server = GameServer::start_at(root.path().to_path_buf(), "127.0.0.1:0").unwrap();
        let first = server.isolated_index_url("a1b2-c3d4").unwrap();
        let second = server.isolated_index_url("e5f6-a7b8").unwrap();
        assert!(first.contains("profile-a1b2-c3d4.localhost:"));
        assert!(second.contains("profile-e5f6-a7b8.localhost:"));
        assert_ne!(first, second);
        assert!(server.isolated_index_url("../invalid").is_err());
    }
}
