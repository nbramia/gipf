// Imported first by index.js, so legacy storage names are moved before any other
// module is evaluated and before anything reads a session, a key or progress.
import { renameLegacyStorage } from './storageRename.js';

renameLegacyStorage();
