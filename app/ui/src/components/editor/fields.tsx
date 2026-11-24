/** Small shared fields of the scene editor (split out of the screen). */
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Placement } from "@/scene/schema";

/** Where a root element sits in a multi-page output. Groups must flow. */
export function PlacementSelect({
  value,
  onChange,
}: {
  value: Placement;
  onChange: (p: Placement) => void;
}) {
  const { t } = useTranslation();
  const isOnly = typeof value === "object";
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1">
        <Label>{t("editor.page")}</Label>
        <Select
          value={isOnly ? "only" : value}
          onValueChange={(v) =>
            onChange(v === "only" ? { only: 2 } : (v as Placement))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="every">{t("editor.page_every")}</SelectItem>
            <SelectItem value="first">{t("editor.page_first")}</SelectItem>
            <SelectItem value="last">{t("editor.page_last")}</SelectItem>
            <SelectItem value="only">{t("editor.page_only")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isOnly && (
        <div className="flex w-20 flex-col gap-1">
          <Label>{t("editor.page_number")}</Label>
          <Input
            type="number"
            min={1}
            value={value.only}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isFinite(n))
                onChange({ only: Math.max(1, Math.round(n)) });
            }}
          />
        </div>
      )}
    </div>
  );
}

export function NumField({
  id,
  label,
  value,
  onChange,
  step = 0.1,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        value={value}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </div>
  );
}

export function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
      <Label className="cursor-pointer text-body-sm">{label}</Label>
    </div>
  );
}
