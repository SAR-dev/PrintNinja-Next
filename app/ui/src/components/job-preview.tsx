/**
 * The prepared job's preview (plan §3.4: what you see is what gets
 * printed). Scene templates show the first page as the printer will
 * raster it — 1 bit per dot, at the profile's dpi. Document templates
 * show the actual PDF the printer will receive.
 */
import { useEffect, useRef, useState } from "react";
import type { Preview } from "@/api";

/** Unpack the 1-bit raster into RGBA pixels: bit set = dot on. */
function packedToImageData(
  packed: number[],
  width: number,
  height: number,
): ImageData {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = packed[y * bytesPerRow + (x >> 3)] ?? 0;
      const on = (byte & (1 << (7 - (x & 7)))) !== 0;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = on ? 17 : 255;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

function BitmapPreview({
  width,
  height,
  packed,
  width_mm,
  height_mm,
}: {
  width: number;
  height: number;
  packed: number[];
  width_mm: number;
  height_mm: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.putImageData(packedToImageData(packed, width, height), 0, 0);
  }, [packed, width, height]);

  // Show at ~15 px per mm regardless of the printer's dpi, so a
  // 40 × 50 label reads as 40 × 50 on screen.
  const scale = 15;
  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={ref}
        style={{
          width: width_mm * scale,
          height: height_mm * scale,
          imageRendering: "pixelated",
        }}
        className="rounded-sm border border-border bg-white"
        aria-label={`Preview: ${width} by ${height} dots`}
      />
      <span className="text-caption text-muted-foreground">
        {width_mm} × {height_mm} mm — first of the pages
      </span>
    </div>
  );
}

function PdfPreview({ pdf }: { pdf: number[] }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([new Uint8Array(pdf)], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [pdf]);

  if (!url) return null;
  return (
    <div className="flex flex-col gap-2">
      <iframe
        src={`${url}#toolbar=0`}
        title="Preview: the PDF the printer will receive"
        className="h-[420px] w-full rounded-sm border border-border bg-white"
      />
      <span className="text-caption text-muted-foreground">
        The PDF the printer will receive
      </span>
    </div>
  );
}

export function JobPreview({ preview }: { preview: Preview }) {
  if (preview.kind === "bitmap") {
    return (
      <BitmapPreview
        width={preview.width}
        height={preview.height}
        packed={preview.packed}
        width_mm={preview.width_mm}
        height_mm={preview.height_mm}
      />
    );
  }
  return <PdfPreview pdf={preview.pdf} />;
}
