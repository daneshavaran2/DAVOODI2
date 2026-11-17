// پوشهٔ داده‌های ماندگار (گزارش جستجوها و آموزش). روی لیارا یک دیسک به همین پوشه وصل کنید، وگرنه با هر استقرار پاک می‌شود.
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = fileURLToPath(new URL('../data/', import.meta.url));
export const dataDir = () => process.env.DATA_DIR || DEFAULT_DIR;
