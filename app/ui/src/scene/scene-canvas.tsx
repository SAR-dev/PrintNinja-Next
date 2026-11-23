/**
 * The scene editor's canvas: the page drawn as SVG, elements you click
 * to select and drag to move (0.1 mm steps). It is a layout aid — the
 * prepared-job preview (plan §3.4) is what the printer will actually
 * get, at its own dpi.
 *
 * Media is always shown as white with black ink, whatever the app's
 * theme, because that is what the printer has.
 */
import { useRef } from "react";
import type { ReactNode } from "react";
import {
  elementsOf,
  pageDims,
  rowHeightMm,
  type Container,
  type Selection,
} from "./editor-model";
import type { Element, Template } from "./schema";

const INK = "#18181b";
const FAINT = "#71717a";
const DASH = "4 3";

interface CanvasProps {
  template: Template;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onMove: (
    container: Container,
    index: number,
    x_mm: number,
    y_mm: number,
  ) => void;
}

interface Drag {
  container: Container;
  index: number;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function SceneCanvas({
  template,
  selection,
  onSelect,
  onMove,
}: CanvasProps) {
  const { w: wMm, h: hMm } = pageDims(template.media);
  const scale = Math.min(12, 480 / wMm);
  const width = wMm * scale;
  const height = hMm * scale;
  const drag = useRef<Drag | null>(null);

  const isSelected = (container: Container, index: number) =>
    selection?.container === container && selection.index === index;

  const beginDrag =
    (container: Container, index: number) => (e: React.PointerEvent) => {
      e.stopPropagation();
      const el = elementsOf(template, container)[index];
      if (!el) return;
      onSelect({ container, index });
      drag.current = {
        container,
        index,
        startX: e.clientX,
        startY: e.clientY,
        origX: el.at.x_mm,
        origY: el.at.y_mm,
      };
      (e.target as SVGElement).setPointerCapture(e.pointerId);
    };

  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onMove(
      d.container,
      d.index,
      round1(d.origX + (e.clientX - d.startX) / scale),
      round1(d.origY + (e.clientY - d.startY) / scale),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="overflow-auto rounded-md border border-border bg-muted/40 p-4">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block"
        style={{ touchAction: "none" }}
        onPointerDown={() => onSelect(null)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="#ffffff"
          stroke="#a1a1aa"
        />
        {template.elements.map((el, i) => (
          <ElementNode
            key={i}
            el={el}
            container="root"
            index={i}
            scale={scale}
            selected={isSelected("root", i)}
            beginDrag={beginDrag}
          />
        ))}
      </svg>
      <div className="mt-2 text-center text-caption text-muted-foreground">
        {wMm} × {hMm} mm — drag an element to move it
      </div>
    </div>
  );
}

/** One selectable element (or group), with its selection ring. */
function ElementNode({
  el,
  container,
  index,
  scale,
  selected,
  beginDrag,
}: {
  el: Element;
  container: Container;
  index: number;
  scale: number;
  selected: boolean;
  beginDrag: (c: Container, i: number) => (e: React.PointerEvent) => void;
}) {
  const [bx, by, bw, bh] = boundsMm(el);
  return (
    <g className="cursor-move" onPointerDown={beginDrag(container, index)}>
      {el.type === "group" ? (
        <GroupGlyph el={el} scale={scale} />
      ) : (
        glyph(el, scale)
      )}
      {selected && (
        <rect
          x={bx * scale}
          y={by * scale}
          width={bw * scale}
          height={bh * scale}
          fill="none"
          stroke="#2563eb"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/** An element's bounds in mm (selection ring and drag math). */
function boundsMm(el: Element): [number, number, number, number] {
  const { x_mm: x, y_mm: y } = el.at;
  switch (el.type) {
    case "text":
    case "barcode":
    case "image":
    case "rect":
      return [x, y, el.size.w_mm, el.size.h_mm];
    case "qr":
      return [x, y, el.h_mm, el.h_mm];
    case "line":
      return el.vertical
        ? [x, y, el.thickness_mm, el.length_mm]
        : [x, y, el.length_mm, el.thickness_mm];
    case "group": {
      const h =
        el.items.reduce((sum, it) => sum + rowHeightMm(it), 0) +
        Math.max(0, el.items.length - 1) * el.item_gap_mm;
      return [x, y, el.w_mm, Math.max(4, h)];
    }
  }
}

/** How one element (except a group) is drawn at its own position. */
function glyph(el: Element, scale: number): ReactNode {
  switch (el.type) {
    case "text": {
      const align = el.style.align ?? "left";
      const anchor =
        align === "center" ? "middle" : align === "right" ? "end" : "start";
      const x =
        (el.at.x_mm +
          (align === "center"
            ? el.size.w_mm / 2
            : align === "right"
              ? el.size.w_mm
              : 0)) *
        scale;
      return (
        <text
          x={x}
          y={(el.at.y_mm + el.style.size_mm) * scale}
          fontSize={el.style.size_mm * scale}
          fontWeight={el.style.bold ? 700 : 400}
          fontStyle={el.style.italic ? "italic" : undefined}
          textAnchor={anchor}
          fill={INK}
        >
          {el.content}
        </text>
      );
    }
    case "line":
      return (
        <line
          x1={el.at.x_mm * scale}
          y1={el.at.y_mm * scale}
          x2={(el.at.x_mm + (el.vertical ? 0 : el.length_mm)) * scale}
          y2={(el.at.y_mm + (el.vertical ? el.length_mm : 0)) * scale}
          stroke={INK}
          strokeWidth={Math.max(0.5, el.thickness_mm * scale)}
        />
      );
    case "rect":
      return (
        <rect
          x={el.at.x_mm * scale}
          y={el.at.y_mm * scale}
          width={el.size.w_mm * scale}
          height={el.size.h_mm * scale}
          fill={el.fill ? INK : "none"}
          stroke={INK}
          strokeWidth={0.75}
        />
      );
    case "barcode":
      return (
        <Placeholder
          x={el.at.x_mm}
          y={el.at.y_mm}
          w={el.size.w_mm}
          h={el.size.h_mm}
          label={`barcode (${el.kind ?? "code128"})`}
          scale={scale}
        />
      );
    case "qr":
      return (
        <Placeholder
          x={el.at.x_mm}
          y={el.at.y_mm}
          w={el.h_mm}
          h={el.h_mm}
          label="qr"
          scale={scale}
        />
      );
    case "image":
      return (
        <Placeholder
          x={el.at.x_mm}
          y={el.at.y_mm}
          w={el.size.w_mm}
          h={el.size.h_mm}
          label={`image: ${el.src}`}
          scale={scale}
        />
      );
    case "group":
      return null;
  }
}

/** A dashed box standing in for something the canvas does not encode. */
function Placeholder({
  x,
  y,
  w,
  h,
  label,
  scale,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  scale: number;
}) {
  return (
    <g>
      <rect
        x={x * scale}
        y={y * scale}
        width={w * scale}
        height={h * scale}
        fill="none"
        stroke={FAINT}
        strokeWidth={1}
        strokeDasharray={DASH}
      />
      <text
        x={(x + w / 2) * scale}
        y={(y + h / 2) * scale}
        fontSize={Math.max(8, 2.2 * scale)}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={FAINT}
      >
        {label}
      </text>
    </g>
  );
}

/** A group: a dashed column, items stacked as they will flow. */
function GroupGlyph({
  el,
  scale,
}: {
  el: Extract<Element, { type: "group" }>;
  scale: number;
}) {
  let cursor = 0;
  const rows = el.items.map((item) => {
    const top = cursor;
    cursor += rowHeightMm(item) + el.item_gap_mm;
    return { item, top };
  });
  const totalH = Math.max(
    4,
    el.items.reduce((sum, it) => sum + rowHeightMm(it), 0) +
      Math.max(0, el.items.length - 1) * el.item_gap_mm,
  );
  return (
    <g>
      <rect
        x={el.at.x_mm * scale}
        y={el.at.y_mm * scale}
        width={el.w_mm * scale}
        height={totalH * scale}
        fill="none"
        stroke={FAINT}
        strokeWidth={1}
        strokeDasharray={DASH}
      />
      <text
        x={(el.at.x_mm + 1) * scale}
        y={(el.at.y_mm + 2.5) * scale}
        fontSize={Math.max(8, 2.2 * scale)}
        fill={FAINT}
      >
        one row per {el.bind}
      </text>
      {rows.map(({ item, top }, i) => (
        <g
          key={i}
          transform={`translate(${el.at.x_mm * scale} ${
            (el.at.y_mm + top + 4) * scale
          })`}
        >
          {glyph(item, scale)}
        </g>
      ))}
    </g>
  );
}
