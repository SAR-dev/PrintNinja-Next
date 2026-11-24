/**
 * The scene editor's canvas: the page drawn as SVG, elements you click
 * to select and drag to move (0.1 mm steps). It is a layout aid — the
 * prepared-job preview (plan §3.4) is what the printer will actually
 * get, at its own dpi.
 *
 * Barcodes and QR codes are drawn live from the Rust core's module
 * patterns — the same encoders the print path uses (REFACTORING
 * decision #13: preview and print must agree on what a symbol is) —
 * with the first sample record substituted for the bindings. A value
 * that cannot be encoded shows a dashed box with the reason, never a
 * fake symbol.
 *
 * Media is always shown as white with black ink, whatever the app's
 * theme, because that is what the printer has.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { encodeSymbol, symbolCacheGet, type SymbolEncoding } from "@/api";
import {
  boundsMm,
  getAt,
  pageDims,
  resizeBox,
  rowHeightMm,
  samePath,
  type Path,
  type Selection,
} from "./editor-model";
import {
  bindingNames,
  substituteBindings,
  type Element,
  type Template,
} from "./schema";

const INK = "#18181b";
const FAINT = "#71717a";
const DASH = "4 3";
const WARN = "#f59e0b";

interface CanvasProps {
  template: Template;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onMove: (path: Path, x_mm: number, y_mm: number) => void;
  /** A drag is actually moving (the first pointer move) — one undo
   * step per drag. */
  onDragStart: (path: Path) => void;
  /** The selected element's new box from a resize handle, in its
   * parent's coordinates. */
  onResize: (
    path: Path,
    x_mm: number,
    y_mm: number,
    w_mm: number,
    h_mm: number,
  ) => void;
  /** The first sample record, for substituting the bindings. */
  record: Record<string, unknown> | null;
  /** Whether the bindings show as sample data (on) or as `{{fields}}`. */
  showSample: boolean;
  /** The selected printer's dpi, for the fit warning. */
  dpi: number | null;
}

interface Drag {
  path: Path;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  started: boolean;
}

/** A resize handle under the pointer: the box's origin as the drag
 * began, and which corner or edge is being pulled. */
interface Resize {
  path: Path;
  handle: string;
  startX: number;
  startY: number;
  ox: number;
  oy: number;
  ow: number;
  oh: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function SceneCanvas({
  template,
  selection,
  onSelect,
  onMove,
  onDragStart,
  onResize,
  record,
  showSample,
  dpi,
}: CanvasProps) {
  const { w: wMm, h: hMm } = pageDims(template.media);
  const scale = Math.min(12, 480 / wMm);
  const width = wMm * scale;
  const height = hMm * scale;
  const drag = useRef<Drag | null>(null);
  const resize = useRef<Resize | null>(null);

  const isSelected = (path: Path) =>
    selection ? samePath(selection.path, path) : false;

  const beginDrag = (path: Path) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = getAt(template, path);
    if (!el) return;
    onSelect({ path });
    drag.current = {
      path,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.at.x_mm,
      origY: el.at.y_mm,
      started: false,
    };
    (e.target as SVGElement).setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.started) {
      d.started = true;
      onDragStart(d.path);
    }
    onMove(
      d.path,
      round1(d.origX + (e.clientX - d.startX) / scale),
      round1(d.origY + (e.clientY - d.startY) / scale),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const beginResize =
    (path: Path, handle: string) => (e: React.PointerEvent) => {
      e.stopPropagation();
      const el = getAt(template, path);
      if (!el || !("size" in el)) return;
      onSelect({ path });
      const [x, y, w, h] = boundsMm(el);
      resize.current = {
        path,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        ox: x,
        oy: y,
        ow: w,
        oh: h,
      };
      (e.target as SVGElement).setPointerCapture(e.pointerId);
    };

  const moveResize = (e: React.PointerEvent) => {
    const r = resize.current;
    if (!r) return;
    const [x, y, w, h] = resizeBox(
      r.ox,
      r.oy,
      r.ow,
      r.oh,
      r.handle,
      (e.clientX - r.startX) / scale,
      (e.clientY - r.startY) / scale,
    );
    onResize(r.path, x, y, w, h);
  };

  const endResize = () => {
    resize.current = null;
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
        onPointerMove={(e) => {
          // A move and a resize are never live at the same time.
          moveDrag(e);
          moveResize(e);
        }}
        onPointerUp={() => {
          endDrag();
          endResize();
        }}
        onPointerLeave={() => {
          endDrag();
          endResize();
        }}
      >
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="#ffffff"
          stroke="#a1a1aa"
        />
        {template.elements.map((el, i) => {
          const path: Path = [i];
          return (
            <ElementNode
              key={i}
              el={el}
              path={path}
              scale={scale}
              selected={isSelected(path)}
              isSelected={isSelected}
              beginDrag={beginDrag}
              beginResize={beginResize}
              record={record}
              showSample={showSample}
              dpi={dpi}
            />
          );
        })}
      </svg>
      <div className="mt-2 text-center text-caption text-muted-foreground">
        {wMm} × {hMm} mm — drag an element to move it
      </div>
    </div>
  );
}

interface GlyphProps {
  el: Element;
  scale: number;
  record: Record<string, unknown> | null;
  showSample: boolean;
  dpi: number | null;
}

/** One selectable element (or group or frame), with its selection
 * ring and — for an element with a size — its resize handles. A
 * frame's children are selectable in their own right: the deepest
 * element under the pointer wins. */
function ElementNode({
  el,
  path,
  scale,
  selected,
  isSelected,
  beginDrag,
  beginResize,
  record,
  showSample,
  dpi,
}: {
  el: Element;
  path: Path;
  scale: number;
  selected: boolean;
  isSelected: (path: Path) => boolean;
  beginDrag: (path: Path) => (e: React.PointerEvent) => void;
  beginResize: (path: Path, handle: string) => (e: React.PointerEvent) => void;
  record: Record<string, unknown> | null;
  showSample: boolean;
  dpi: number | null;
}) {
  const [bx, by, bw, bh] = boundsMm(el);
  return (
    <g className="cursor-move" onPointerDown={beginDrag(path)}>
      {el.type === "frame" ? (
        <FrameGlyph
          el={el}
          path={path}
          scale={scale}
          isSelected={isSelected}
          beginDrag={beginDrag}
          beginResize={beginResize}
          record={record}
          showSample={showSample}
          dpi={dpi}
        />
      ) : el.type === "group" ? (
        <GroupGlyph
          el={el}
          scale={scale}
          record={record}
          showSample={showSample}
          dpi={dpi}
        />
      ) : (
        glyph(el, scale, record, showSample, dpi)
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
      {selected && "size" in el && (
        <ResizeHandles
          x={bx * scale}
          y={by * scale}
          w={bw * scale}
          h={bh * scale}
          path={path}
          beginResize={beginResize}
        />
      )}
    </g>
  );
}

/** The eight resize handles (corners and edges) of a selected box,
 * in the parent's coordinates. */
const HANDLES: { h: string; fx: number; fy: number; cursor: string }[] = [
  { h: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { h: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { h: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { h: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { h: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { h: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { h: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { h: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

function ResizeHandles({
  x,
  y,
  w,
  h,
  path,
  beginResize,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  path: Path;
  beginResize: (path: Path, handle: string) => (e: React.PointerEvent) => void;
}) {
  return (
    <g>
      {HANDLES.map(({ h: handle, fx, fy, cursor }) => (
        <rect
          key={handle}
          x={x + fx * w - 3}
          y={y + fy * h - 3}
          width={6}
          height={6}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={1.5}
          style={{ cursor }}
          onPointerDown={beginResize(path, handle)}
        />
      ))}
    </g>
  );
}

/** A frame: its border, then its children at coordinates relative to
 * the frame's top-left. The border is skipped at 0, as the renderer
 * does. Without `path` it draws plain (a frame in a group row); with
 * it, each child is itself selectable. */
function FrameGlyph({
  el,
  path,
  scale,
  isSelected,
  beginDrag,
  beginResize,
  record,
  showSample,
  dpi,
}: {
  el: Extract<Element, { type: "frame" }>;
  path?: Path;
  scale: number;
  isSelected?: (path: Path) => boolean;
  beginDrag?: (path: Path) => (e: React.PointerEvent) => void;
  beginResize?: (path: Path, handle: string) => (e: React.PointerEvent) => void;
  record: Record<string, unknown> | null;
  showSample: boolean;
  dpi: number | null;
}) {
  const interactive = path !== undefined && isSelected !== undefined;
  return (
    <g transform={`translate(${el.at.x_mm * scale} ${el.at.y_mm * scale})`}>
      {interactive && (
        // The frame's interior, so the box itself is clickable where no
        // child sits; the children, drawn above, take the pointer first.
        <rect
          width={el.size.w_mm * scale}
          height={el.size.h_mm * scale}
          fill="transparent"
        />
      )}
      {el.border_mm > 0 && (
        <rect
          width={el.size.w_mm * scale}
          height={el.size.h_mm * scale}
          fill="none"
          stroke={INK}
          strokeWidth={Math.max(0.5, el.border_mm * scale)}
        />
      )}
      {el.children.map((child, i) =>
        interactive ? (
          <ElementNode
            key={i}
            el={child}
            path={[...path, i]}
            scale={scale}
            selected={isSelected([...path, i])}
            isSelected={isSelected}
            beginDrag={beginDrag!}
            beginResize={beginResize!}
            record={record}
            showSample={showSample}
            dpi={dpi}
          />
        ) : (
          <g key={i}>{glyph(child, scale, record, showSample, dpi)}</g>
        ),
      )}
    </g>
  );
}

/** The bindings in `s`, filled from the sample record when the
 * canvas shows sample data — else the raw template text. */
function displayText(
  s: string,
  record: Record<string, unknown> | null,
  showSample: boolean,
): string {
  return showSample ? substituteBindings(s, record) : s;
}

/**
 * The module pattern of a symbol, debounced ~150 ms so typing in the
 * value field does not flood the bridge, and cached per (kind, value).
 * `undefined` while a value is being fetched, `null` when it cannot
 * be encoded.
 */
function useSymbol(
  kind: string,
  value: string,
): SymbolEncoding | null | undefined {
  const [enc, setEnc] = useState<SymbolEncoding | null | undefined>(() =>
    symbolCacheGet(kind, value),
  );
  useEffect(() => {
    const hit = symbolCacheGet(kind, value);
    if (hit !== undefined) {
      setEnc(hit);
      return;
    }
    setEnc(undefined);
    let live = true;
    const t = setTimeout(() => {
      encodeSymbol(kind, value).then((r) => {
        if (live) setEnc(r);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, value]);
  return enc;
}

/** Whether the symbol's modules fit a whole printer dot at `dpi`. */
function symbolFits(
  enc: SymbolEncoding,
  box_mm: number,
  dpi: number | null,
): boolean {
  if (dpi === null || box_mm <= 0) return true;
  const total = enc.side
    ? enc.side + 2 * enc.quiet
    : enc.modules.length + 2 * enc.quiet;
  return (box_mm * dpi) / 25.4 / total >= 1;
}

/** A small amber badge: the symbol is wider than its box allows. */
function FitBadge({ x, y }: { x: number; y: number }) {
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={2.6} fill={WARN} />
      <text
        x={x}
        y={y + 1}
        fontSize={3.6}
        fontWeight={700}
        textAnchor="middle"
        fill="#ffffff"
      >
        !
      </text>
    </g>
  );
}

/** The short reason a value cannot be encoded, for the failure box. */
function symbolReason(kind: string, value: string): string {
  const v = value.trim();
  if (v === "") return "empty value";
  switch (kind) {
    case "ean13":
      return "EAN-13 needs 13 digits with a matching check digit";
    case "upca":
      return "UPC-A needs 12 digits with a matching check digit";
    case "itf":
      return "ITF needs an even number of digits";
    case "code128":
      return "Code 128 needs printable ASCII";
    default:
      return "this value cannot be encoded";
  }
}

/** A live 1-D barcode, from the core's module pattern. */
function BarcodeGlyph({
  el,
  scale,
  record,
  showSample,
  dpi,
}: GlyphProps & { el: Extract<Element, { type: "barcode" }> }) {
  const kind = el.kind ?? "code128";
  const shown = displayText(el.value, record, showSample);
  // An un-substituted binding cannot be encoded; the canvas shows the
  // raw value instead of a symbol of `{{...}}`.
  const pending = bindingNames(shown).length > 0;
  const enc = useSymbol(kind, pending ? "" : shown);
  const { x_mm: x, y_mm: y } = el.at;
  const { w_mm: w, h_mm: h } = el.size;

  if (pending || enc === undefined || enc === null) {
    return (
      <Placeholder
        x={x}
        y={y}
        w={w}
        h={h}
        label={
          pending
            ? `barcode (${kind})`
            : enc === undefined
              ? "…"
              : symbolReason(kind, shown)
        }
        scale={scale}
      />
    );
  }

  const showText = el.show_text !== false;
  const text_mm = showText ? Math.min(0.3 * h, 2.5) : 0;
  const bar_h = h - text_mm;
  const mod_w = w / (enc.modules.length + 2 * enc.quiet);
  const bars: ReactNode[] = [];
  for (let i = 0; i < enc.modules.length; ) {
    if (enc.modules[i] === 1) {
      const start = i;
      while (i < enc.modules.length && enc.modules[i] === 1) i += 1;
      bars.push(
        <rect
          key={start}
          x={(x + (start + enc.quiet) * mod_w) * scale}
          y={y * scale}
          width={(i - start) * mod_w * scale}
          height={bar_h * scale}
          fill={INK}
        />,
      );
    } else {
      i += 1;
    }
  }
  const fontSize = Math.max(1.2, Math.min(0.2 * h, 2.5));
  return (
    <g>
      {bars}
      {showText && (
        <text
          x={(x + w / 2) * scale}
          y={(y + bar_h + 0.75 * text_mm) * scale}
          fontSize={fontSize * scale}
          textAnchor="middle"
          fill={INK}
        >
          {shown}
        </text>
      )}
      {!symbolFits(enc, w, dpi) && (
        <FitBadge x={(x + w - 2.5) * scale} y={(y + 2.5) * scale} />
      )}
    </g>
  );
}

/** A live QR code, one path of dark modules from the core's matrix. */
function QrGlyph({
  el,
  scale,
  record,
  showSample,
  dpi,
}: GlyphProps & { el: Extract<Element, { type: "qr" }> }) {
  const shown = displayText(el.value, record, showSample);
  const pending = bindingNames(shown).length > 0;
  const enc = useSymbol("qr", pending ? "" : shown);
  const { x_mm: x, y_mm: y } = el.at;
  const h = el.h_mm;

  if (pending || enc === undefined || enc === null) {
    return (
      <Placeholder
        x={x}
        y={y}
        w={h}
        h={h}
        label={
          pending ? "qr" : enc === undefined ? "…" : symbolReason("qr", shown)
        }
        scale={scale}
      />
    );
  }

  const side = enc.side ?? 1;
  const cell = h / (side + 2 * enc.quiet);
  let d = "";
  for (let r = 0; r < side; r += 1) {
    for (let c = 0; c < side; c += 1) {
      if (enc.modules[r * side + c] === 0) continue;
      const px = x + (c + enc.quiet) * cell;
      const py = y + (r + enc.quiet) * cell;
      d += `M${px * scale} ${py * scale}h${cell * scale}v${cell * scale}h${-cell * scale}Z`;
    }
  }
  return (
    <g>
      <path d={d} fill={INK} />
      {!symbolFits(enc, h, dpi) && (
        <FitBadge x={(x + h - 2.5) * scale} y={(y + 2.5) * scale} />
      )}
    </g>
  );
}

/** How one element (except a group) is drawn at its own position. */
function glyph(
  el: Element,
  scale: number,
  record: Record<string, unknown> | null,
  showSample: boolean,
  dpi: number | null,
): ReactNode {
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
          {displayText(el.content, record, showSample)}
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
        <BarcodeGlyph
          el={el}
          scale={scale}
          record={record}
          showSample={showSample}
          dpi={dpi}
        />
      );
    case "qr":
      return (
        <QrGlyph
          el={el}
          scale={scale}
          record={record}
          showSample={showSample}
          dpi={dpi}
        />
      );
    case "image":
      if (el.src.startsWith("data:")) {
        return (
          <image
            href={el.src}
            x={el.at.x_mm * scale}
            y={el.at.y_mm * scale}
            width={el.size.w_mm * scale}
            height={el.size.h_mm * scale}
            preserveAspectRatio="xMidYMid meet"
          />
        );
      }
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
    case "frame":
      return (
        <FrameGlyph
          el={el}
          scale={scale}
          record={record}
          showSample={showSample}
          dpi={dpi}
        />
      );
    case "group":
      return null;
  }
}

/** A dashed box standing in for something the canvas does not draw
 * live: an unencodable value, an image without a data URI, or a
 * symbol whose value is still a binding. */
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
  record,
  showSample,
  dpi,
}: {
  el: Extract<Element, { type: "group" }>;
  scale: number;
  record: Record<string, unknown> | null;
  showSample: boolean;
  dpi: number | null;
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
          {glyph(item, scale, record, showSample, dpi)}
        </g>
      ))}
    </g>
  );
}
