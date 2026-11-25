/**
 * An image file saved into the canvas's assets (`assets.upload`), as an image node's file and a
 * fill's picture are (ADR 0149).
 */
import { api } from "../state/connection.ts";

/** A file's contents in base64, as the upload takes them. */
const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Saves `file` into the canvas's assets: its path there, `assets/hero.png`. */
export const uploadImage = async (file: File): Promise<string> => {
  const { src } = await api().request("assets.upload", {
    data: await base64Of(file),
    name: file.name,
  });
  return src;
};
