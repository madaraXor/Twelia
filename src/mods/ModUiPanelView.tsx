import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ModUiComponent, ModUiPanel, ModUiTone } from "./modTypes";

const toneClassName: Record<ModUiTone, string> = {
  default: "text-slate-200",
  muted: "text-slate-500",
  info: "text-sky-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-red-300",
};

const badgeClassName: Record<ModUiTone, string> = {
  default: "bg-white/10 text-slate-200",
  muted: "bg-slate-500/10 text-slate-400",
  info: "bg-sky-400/10 text-sky-300",
  success: "bg-emerald-400/10 text-emerald-300",
  warning: "bg-amber-400/10 text-amber-300",
  danger: "bg-red-400/10 text-red-300",
};

type ActionHandler = (actionId: string, value?: unknown) => Promise<void>;

export function ModUiPanelView({
  panel,
  onAction,
}: {
  panel: ModUiPanel;
  onAction: ActionHandler;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues(panel.components),
  );
  const [pendingAction, setPendingAction] = useState<string>();
  const dirtyValues = useRef(new Set<string>());

  useEffect(() => {
    setValues((current) => {
      const next = initialValues(panel.components);
      for (const id of dirtyValues.current) {
        if (current[id] !== undefined) next[id] = current[id];
      }
      return next;
    });
  }, [panel.components, panel.revision]);

  const dispatch = async (actionId: string, value?: unknown) => {
    setPendingAction(actionId);
    try {
      await onAction(actionId, value);
    } finally {
      setPendingAction(undefined);
      dirtyValues.current.delete(actionId);
    }
  };

  const renderComponent = (component: ModUiComponent, path: string): ReactNode => {
    switch (component.type) {
      case "section":
        return (
          <section key={path} className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
            {component.title && (
              <h4 className="mb-2 text-xs font-semibold text-slate-200">{component.title}</h4>
            )}
            <div className="space-y-2">
              {component.children.map((child, index) => renderComponent(child, `${path}.${index}`))}
            </div>
          </section>
        );
      case "row":
        return (
          <div key={path} className="flex flex-wrap items-center gap-2">
            {component.children.map((child, index) => renderComponent(child, `${path}.${index}`))}
          </div>
        );
      case "text": {
        const tone = component.tone ?? "default";
        return (
          <p
            key={path}
            className={cn(
              "break-words",
              toneClassName[tone],
              component.style === "heading" && "text-sm font-semibold",
              component.style === "caption" && "text-[10px] leading-4",
              component.style === "code" &&
                "rounded bg-black/25 px-2 py-1 font-mono text-[10px] leading-4",
              (!component.style || component.style === "body") && "text-xs leading-5",
            )}
          >
            {component.text}
          </p>
        );
      }
      case "badge": {
        const tone = component.tone ?? "default";
        return (
          <span
            key={path}
            className={cn(
              "inline-flex min-h-5 items-center rounded-md px-1.5 text-[10px] font-semibold",
              badgeClassName[tone],
            )}
          >
            {component.text}
          </span>
        );
      }
      case "button": {
        const pending = pendingAction === component.id;
        const variant =
          component.variant === "danger"
            ? "destructive"
            : component.variant === "secondary"
              ? "secondary"
              : component.variant === "ghost"
                ? "ghost"
                : "default";
        return (
          <Button
            key={path}
            variant={variant}
            size="sm"
            className="min-w-0 max-w-full"
            disabled={component.disabled || pending}
            onClick={() => void dispatch(component.id)}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            <span className="truncate">{component.label}</span>
          </Button>
        );
      }
      case "input": {
        const value = values[component.id] ?? component.value ?? "";
        return (
          <div key={path} className="grid min-w-0 flex-1 gap-1">
            {component.label && (
              <Label htmlFor={`${panel.modId}-${panel.id}-${component.id}`} className="text-[10px]">
                {component.label}
              </Label>
            )}
            <Input
              id={`${panel.modId}-${panel.id}-${component.id}`}
              className="h-8 rounded-md border-white/10 bg-black/20 px-2 text-xs text-slate-100"
              value={value}
              placeholder={component.placeholder}
              maxLength={512}
              disabled={component.disabled || pendingAction === component.id}
              onChange={(event) => {
                dirtyValues.current.add(component.id);
                setValues((current) => ({ ...current, [component.id]: event.target.value }));
              }}
              onBlur={() => void dispatch(component.id, value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
        );
      }
      case "textarea": {
        const value = values[component.id] ?? component.value ?? "";
        return (
          <div key={path} className="grid min-w-0 flex-1 gap-1">
            {component.label && (
              <Label htmlFor={`${panel.modId}-${panel.id}-${component.id}`} className="text-[10px]">
                {component.label}
              </Label>
            )}
            <textarea
              id={`${panel.modId}-${panel.id}-${component.id}`}
              className="min-h-28 resize-y rounded-md border border-white/10 bg-black/20 px-2 py-1.5 font-mono text-[10px] leading-4 text-slate-100 outline-none focus:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={value}
              placeholder={component.placeholder}
              maxLength={16_000}
              disabled={component.disabled || pendingAction === component.id}
              onChange={(event) => {
                dirtyValues.current.add(component.id);
                setValues((current) => ({ ...current, [component.id]: event.target.value }));
              }}
              onBlur={() => void dispatch(component.id, value)}
            />
          </div>
        );
      }
      case "select": {
        const value = values[component.id] ?? component.value ?? component.options[0]?.value ?? "";
        return (
          <div key={path} className="grid min-w-0 flex-1 gap-1">
            {component.label && (
              <Label htmlFor={`${panel.modId}-${panel.id}-${component.id}`} className="text-[10px]">
                {component.label}
              </Label>
            )}
            <select
              id={`${panel.modId}-${panel.id}-${component.id}`}
              className="h-8 min-w-0 rounded-md border border-white/10 bg-[#171a22] px-2 text-xs text-slate-100 outline-none focus:border-primary/50"
              value={value}
              disabled={component.disabled || pendingAction === component.id}
              onChange={(event) => {
                const nextValue = event.target.value;
                dirtyValues.current.add(component.id);
                setValues((current) => ({ ...current, [component.id]: nextValue }));
                void dispatch(component.id, nextValue);
              }}
            >
              {component.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        );
      }
      case "switch": {
        const checked = (values[component.id] ?? String(component.value ?? false)) === "true";
        return (
          <div key={path} className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <Label htmlFor={`${panel.modId}-${panel.id}-${component.id}`} className="text-xs">
              {component.label}
            </Label>
            <Switch
              id={`${panel.modId}-${panel.id}-${component.id}`}
              checked={checked}
              disabled={component.disabled || pendingAction === component.id}
              onCheckedChange={(nextValue) => {
                setValues((current) => ({ ...current, [component.id]: String(nextValue) }));
                void dispatch(component.id, nextValue);
              }}
            />
          </div>
        );
      }
      case "number": {
        const value = values[component.id] ?? String(component.value ?? "");
        return (
          <div key={path} className="grid min-w-0 flex-1 gap-1">
            {component.label && (
              <Label htmlFor={`${panel.modId}-${panel.id}-${component.id}`} className="text-[10px]">
                {component.label}
              </Label>
            )}
            <Input
              id={`${panel.modId}-${panel.id}-${component.id}`}
              type="number"
              className="h-8 rounded-md border-white/10 bg-black/20 px-2 text-xs text-slate-100"
              value={value}
              min={component.minimum}
              max={component.maximum}
              step={component.step}
              placeholder={component.placeholder}
              disabled={component.disabled || pendingAction === component.id}
              onChange={(event) => {
                dirtyValues.current.add(component.id);
                setValues((current) => ({ ...current, [component.id]: event.target.value }));
              }}
              onBlur={() => void dispatch(component.id, value === "" ? null : Number(value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </div>
        );
      }
      case "slider": {
        const value = Number(values[component.id] ?? component.value ?? component.minimum ?? 0);
        return (
          <div key={path} className="grid min-w-0 flex-1 gap-2">
            {component.label && (
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <Label>{component.label}</Label>
                <span className="font-mono text-muted-foreground">{value}</span>
              </div>
            )}
            <Slider
              value={[value]}
              min={component.minimum ?? 0}
              max={component.maximum ?? 100}
              step={component.step ?? 1}
              disabled={component.disabled || pendingAction === component.id}
              onValueChange={([nextValue]) =>
                setValues((current) => ({ ...current, [component.id]: String(nextValue) }))
              }
              onValueCommit={([nextValue]) => void dispatch(component.id, nextValue)}
            />
          </div>
        );
      }
      case "progress":
        return (
          <div key={path} className="grid gap-1.5">
            {component.label && (
              <div className="flex justify-between text-[10px] text-slate-300">
                <span>{component.label}</span>
                <span>{Math.round(component.value ?? 0)}%</span>
              </div>
            )}
            <Progress value={component.value ?? 0} className="h-1.5" />
          </div>
        );
      case "collapsible":
        return (
          <details
            key={path}
            open={component.open}
            className="rounded-lg border border-white/8 bg-white/[0.025]"
          >
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-200">
              {component.title}
            </summary>
            <div className="space-y-2 border-t border-white/8 p-3">
              {component.children.map((child, index) => renderComponent(child, `${path}.${index}`))}
            </div>
          </details>
        );
      case "table":
        return (
          <div key={path} className="overflow-x-auto rounded-md border border-white/8">
            <table className="w-full text-left text-[10px]">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  {component.columns.map((column) => (
                    <th key={column.key} className="px-2 py-1.5 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-200">
                {component.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {component.columns.map((column) => (
                      <td key={column.key} className="max-w-48 truncate px-2 py-1.5">
                        {String(row[column.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "separator":
        return <hr key={path} className="border-0 border-t border-white/10" />;
    }
  };

  return (
    <div className="space-y-2">
      {panel.components.map((component, index) => renderComponent(component, String(index)))}
    </div>
  );
}

function initialValues(components: ModUiComponent[]): Record<string, string> {
  const values: Record<string, string> = {};
  const visit = (component: ModUiComponent) => {
    if (
      component.type === "input" ||
      component.type === "textarea" ||
      component.type === "select" ||
      component.type === "number" ||
      component.type === "slider" ||
      component.type === "switch"
    ) {
      values[component.id] = String(component.value ?? "");
    } else if (
      component.type === "section" ||
      component.type === "row" ||
      component.type === "collapsible"
    ) {
      component.children.forEach(visit);
    }
  };
  components.forEach(visit);
  return values;
}
