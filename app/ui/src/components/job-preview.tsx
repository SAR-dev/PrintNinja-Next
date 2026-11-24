/**
 * The prepared job's pages (plan §3.4: what you see is what gets
 * printed). Scene templates show every page as the printer will raster
 * it — 1 bit per dot, at the profile's dpi. Document templates show the
 * actual PDF(s) the printer will receive — one per record on the
 * browser path, the whole document on the pdf path.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Preview } from "@/api";

type Bitmap = Extract<Preview, { kind: "bitmap" }>;
type Pdf = Extract<Preview, { kind: "pdf" }>;

function isBitmap(p: Preview): p is Bitmap {
  return p.kind === "bitmap";
}

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
  scale,
  caption,
}: {
  width: number;
  height: number;
  packed: number[];
  width_mm: number;
  height_mm: number;
  /** Display pixels per millimetre. */
  scale: number;
  caption: string;
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
        aria-label={caption}
      />
      <span className="text-caption text-muted-foreground">{caption}</span>
    </div>
  );
}

function PdfPreview({ pdf }: { pdf: number[] }) {
  const { t } = useTranslation();
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
        title={t("preview.pdf_iframe_title")}
        className="h-[420px] w-full rounded-sm border border-border bg-white"
      />
      <span className="text-caption text-muted-foreground">
        {t("preview.pdf_caption")}
      </span>
    </div>
  );
}

/**
 * Every page of the prepared job, in order. Scene pages show as a
 * thumbnail grid when there is more than one of them; document PDFs
 * stack one per record.
 */
export function JobPreview({ previews }: { previews: Preview[] }) {
  const { t } = useTranslation();
  if (previews.length === 0) return null;
  const bitmaps = previews.filter(isBitmap);

  if (bitmaps.length === previews.length) {
    const multi = previews.length > 1;
    return (
      <div
        className={
          multi
            ? "grid max-h-[520px] grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto pr-1"
            : "flex flex-col items-center gap-2"
        }
      >
        {bitmaps.map((p, i) => (
          <BitmapPreview
            key={i}
            width={p.width}
            height={p.height}
            packed={p.packed}
            width_mm={p.width_mm}
            height_mm={p.height_mm}
            scale={multi ? Math.min(15, 150 / p.width_mm) : 15}
            caption={
              multi
                ? t("preview.page_of", {
                    current: i + 1,
                    total: bitmaps.length,
                  })
                : t("preview.size_mm", {
                    width: p.width_mm,
                    height: p.height_mm,
                  })
            }
          />
        ))}
      </div>
    );
  }

  const pdfs = previews.filter((p): p is Pdf => p.kind === "pdf");
  return (
    <div className="flex flex-col gap-4">
      {pdfs.map((p, i) => (
        <div key={i} className="flex flex-col gap-2">
          <PdfPreview pdf={p.pdf} />
          {pdfs.length > 1 && (
            <span className="text-caption text-muted-foreground">
              {t("preview.document_of", { current: i + 1, total: pdfs.length })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
