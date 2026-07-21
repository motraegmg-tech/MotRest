/**
 * Preparación del entorno de pruebas: `fake-indexeddb` implementa la
 * especificación real de IndexedDB, de modo que las pruebas ejercitan el mismo
 * código que corre en el navegador.
 */
import { IDBFactory } from "fake-indexeddb";

globalThis.indexedDB = new IDBFactory();
