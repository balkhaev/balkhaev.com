import { CONTACTS } from "./scene-geometry";

/** Emissive lettering on two attitude-stabilized, double-sided test surfaces. */
export function contactAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    return canvas;
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const [index, contact] of CONTACTS.entries()) {
    const y = index * 128 + 64;
    context.font = '400 76px "Segoe UI", sans-serif';
    context.fillStyle = "#f4ead8";
    const textWidth = context.measureText(contact.label).width;
    const scale = 1360 / textWidth;
    context.save();
    context.translate(768, y);
    context.scale(scale, 1);
    context.fillText(contact.label, 0, 0);
    context.restore();
  }
  return canvas;
}
