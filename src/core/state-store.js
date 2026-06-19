/**
 * Central state management with EventEmitter pattern.
 * Holds all symbol data, canvas state, and provides pub/sub for UI sync.
 */

import { debounce } from '../utils/debounce.js';

const STORAGE_KEY = 'symbex_project';

class StateStore {
  constructor() {
    /** @type {Map<string, object>} symbol id → symbol data */
    this.symbols = new Map();

    /** @type {Set<string>} currently selected symbol ids */
    this.selectedIds = new Set();

    /** Canvas viewport state */
    this.canvasState = {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      gridEnabled: true,
    };

    /** Project metadata */
    this.projectName = 'Untitled Project';
    this.pdfName = null;

    /** Undo / Redo */
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistory = 50;

    /** Event listeners */
    this._listeners = {};

    /** Auto-save */
    this._debouncedSave = debounce(() => this._saveToStorage(), 5000);
  }

  // ── Events ────────────────────────────────────────────────

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this._listeners[event]) return;
    for (const cb of this._listeners[event]) {
      cb(data);
    }
  }

  // ── Symbols CRUD ──────────────────────────────────────────

  addSymbol(symbol) {
    this.symbols.set(symbol.id, { ...symbol });
    this.emit('symbol:added', symbol);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  addSymbols(symbols) {
    for (const s of symbols) {
      this.symbols.set(s.id, { ...s });
    }
    this.emit('symbols:bulk-added', symbols);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  getSymbol(id) {
    return this.symbols.get(id) || null;
  }

  getAllSymbols() {
    return [...this.symbols.values()];
  }

  updateSymbol(id, updates) {
    const sym = this.symbols.get(id);
    if (!sym) return;
    const updated = { ...sym, ...updates, updatedAt: new Date().toISOString() };
    this.symbols.set(id, updated);
    this.emit('symbol:updated', updated);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  removeSymbol(id) {
    const sym = this.symbols.get(id);
    if (!sym) return;
    this.symbols.delete(id);
    this.selectedIds.delete(id);
    this.emit('symbol:removed', { id });
    this.emit('symbols:changed', this.getAllSymbols());
    this.emit('selection:changed', [...this.selectedIds]);
    this._debouncedSave();
  }

  // ── Properties ────────────────────────────────────────────

  addProperty(symbolId, property) {
    const sym = this.symbols.get(symbolId);
    if (!sym) return;
    if (!sym.properties) sym.properties = [];
    sym.properties.push(property);
    sym.updatedAt = new Date().toISOString();
    this.emit('symbol:updated', sym);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  updateProperty(symbolId, index, updates) {
    const sym = this.symbols.get(symbolId);
    if (!sym || !sym.properties[index]) return;
    sym.properties[index] = { ...sym.properties[index], ...updates };
    sym.updatedAt = new Date().toISOString();
    this.emit('symbol:updated', sym);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  removeProperty(symbolId, index) {
    const sym = this.symbols.get(symbolId);
    if (!sym || !sym.properties) return;
    sym.properties.splice(index, 1);
    sym.updatedAt = new Date().toISOString();
    this.emit('symbol:updated', sym);
    this.emit('symbols:changed', this.getAllSymbols());
    this._debouncedSave();
  }

  // ── Selection ─────────────────────────────────────────────

  select(id, addToSelection = false) {
    if (!addToSelection) {
      this.selectedIds.clear();
    }
    this.selectedIds.add(id);
    this.emit('selection:changed', [...this.selectedIds]);
  }

  deselect(id) {
    this.selectedIds.delete(id);
    this.emit('selection:changed', [...this.selectedIds]);
  }

  clearSelection() {
    this.selectedIds.clear();
    this.emit('selection:changed', []);
  }

  getSelectedSymbols() {
    return [...this.selectedIds].map(id => this.symbols.get(id)).filter(Boolean);
  }

  // ── Undo / Redo ───────────────────────────────────────────

  pushUndo(snapshot) {
    this._undoStack.push(snapshot);
    if (this._undoStack.length > this._maxHistory) {
      this._undoStack.shift();
    }
    this._redoStack = [];
    this.emit('history:changed', {
      canUndo: this._undoStack.length > 0,
      canRedo: false,
    });
  }

  undo() {
    if (this._undoStack.length === 0) return null;
    const snapshot = this._undoStack.pop();
    this._redoStack.push(snapshot);
    this.emit('history:changed', {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
    });
    return snapshot;
  }

  redo() {
    if (this._redoStack.length === 0) return null;
    const snapshot = this._redoStack.pop();
    this._undoStack.push(snapshot);
    this.emit('history:changed', {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
    });
    return snapshot;
  }

  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }

  // ── Canvas State ──────────────────────────────────────────

  updateCanvasState(updates) {
    Object.assign(this.canvasState, updates);
    this.emit('canvas:stateChanged', this.canvasState);
    this._debouncedSave();
  }

  // ── Persistence ───────────────────────────────────────────

  _saveToStorage() {
    try {
      const data = this.serialize();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.emit('project:saved', { timestamp: new Date().toISOString() });
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      return this.deserialize(data);
    } catch (e) {
      console.warn('Load from storage failed:', e);
      return false;
    }
  }

  serialize() {
    return {
      version: '1.0.0',
      projectName: this.projectName,
      pdfName: this.pdfName,
      canvasState: { ...this.canvasState },
      symbols: this.getAllSymbols(),
      savedAt: new Date().toISOString(),
    };
  }

  deserialize(data) {
    if (!data || !data.symbols) return false;
    this.projectName = data.projectName || 'Untitled Project';
    this.pdfName = data.pdfName || null;
    if (data.canvasState) {
      Object.assign(this.canvasState, data.canvasState);
    }
    this.symbols.clear();
    for (const sym of data.symbols) {
      this.symbols.set(sym.id, sym);
    }
    this.emit('project:loaded', data);
    this.emit('symbols:changed', this.getAllSymbols());
    return true;
  }

  clearAll() {
    this.symbols.clear();
    this.selectedIds.clear();
    this._undoStack = [];
    this._redoStack = [];
    this.emit('symbols:changed', []);
    this.emit('selection:changed', []);
    this.emit('history:changed', { canUndo: false, canRedo: false });
  }
}

// Singleton
export const store = new StateStore();
