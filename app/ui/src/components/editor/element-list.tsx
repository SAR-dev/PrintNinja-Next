/**
 * The scene editor's element panel: rows with an icon, a selected
 * state and a ⋯ menu for reorder/delete (M8), plus an icon toolbar
 * that replaces the old "Add element…" select.
 */
import { useTranslation } from "react-i18next";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { IconButton } from "@/components/ui/icon-button";
import {
  ELEMENT_TYPES,
  NESTED_ELEMENT_TYPES,
  elementLabel,
  samePath,
  type Path,
  type Selection,
} from "@/scene/editor-model";
import type { Element } from "@/scene/schema";
import { icons, type IconName } from "@/lib/icons";

export function ElementList({
  elements,
  basePath,
  selection,
  onSelect,
  onMove,
  onDelete,
}: {
  elements: Element[];
  basePath: Path;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onMove: (path: Path, delta: number) => void;
  onDelete: (path: Path) => void;
}) {
  const { t } = useTranslation();
  const rows: {
    el: Element;
    path: Path;
    depth: number;
    index: number;
    count: number;
  }[] = [];
  const collect = (els: Element[], base: Path, depth: number) => {
    els.forEach((el, i) => {
      const path = [...base, i];
      rows.push({ el, path, depth, index: i, count: els.length });
      if (el.type === "group") collect(el.items, path, depth + 1);
      else if (el.type === "frame") collect(el.children, path, depth + 1);
    });
  };
  collect(elements, basePath, basePath.length);

  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <span className="text-body-sm text-muted-foreground">
          {t("editor.element_empty")}
        </span>
      )}
      {rows.map(({ el, path, depth, index, count }) => {
        const isSel = selection ? samePath(selection.path, path) : false;
        const Icon = icons[el.type as IconName];
        const items: ActionItem[] = [
          {
            label: t("editor.move_up"),
            icon: "up",
            disabled: index === 0,
            onSelect: () => onMove(path, -1),
          },
          {
            label: t("editor.move_down"),
            icon: "down",
            disabled: index === count - 1,
            onSelect: () => onMove(path, 1),
          },
          {
            label: t("common.delete"),
            icon: "delete",
            danger: true,
            separator: true,
            onSelect: () => onDelete(path),
          },
        ];
        return (
          <div
            key={path.join("/")}
            style={{ marginLeft: (depth - 1) * 16 }}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
              isSel ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            }`}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-body-sm"
              onClick={() => onSelect(isSel ? null : { path })}
            >
              {elementLabel(el)}
            </button>
            <ActionMenu items={items} label={t("common.more")} />
          </div>
        );
      })}
    </div>
  );
}

/** Add an element from an icon toolbar. A group cannot sit in a frame
 * (v1), so a row and a frame offer the same nested set of types. */
export function AddElement({
  onAdd,
  where,
}: {
  onAdd: (type: string) => void;
  where: "root" | "row" | "frame";
}) {
  const types = where === "root" ? ELEMENT_TYPES : NESTED_ELEMENT_TYPES;
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((type) => (
        <IconButton
          key={type}
          icon={type as IconName}
          label={type}
          variant="secondary"
          onClick={() => onAdd(type)}
        />
      ))}
    </div>
  );
}
