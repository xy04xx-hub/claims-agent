// ajv-formats is CommonJS. This wrapper gives it one import shape under NodeNext, vitest and esbuild.
import type { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";

type AddFormats = (ajv: Ajv2020) => unknown;
const mod = formats as unknown as AddFormats | { default: AddFormats };
export const addFormats: AddFormats = typeof mod === "function" ? mod : mod.default;
