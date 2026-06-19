/**
 * Fabric.js canvas manager — handles canvas setup, symbol placement,
 * interactions (select, move, resize, rotate), pan/zoom, and undo/redo.
 */

import { Canvas, FabricImage, ActiveSelection } from 'fabric';
import { store } from './state-store.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const GRID_COLUMNS = 4;
const CELL_PADDING = 30;
const MAX_THUMB_SIZE = 180;

class CanvasManager {
  constructor() {
    /** @type {Canvas|null} */
    this.canvas = null;
    /** Map from symbol id → fabric object */
    this.objectMap = new Map();
    this._isPanning = false;
    this._lastPanPos = null;
    this._isModifying = false;
  }

  /**
   * Initialise the Fabric.js canvas.
   * @param {string} canvasId - The ID of the <canvas> element
   */
  init(canvasId) {
    const container = document.getElementById('canvas-area');
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.canvas = new Canvas(canvasId, {
      width,
      height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
    });

    // Style selection controls
    this._configureControls();

    // ── Event handlers ──────────────────────────────────────
    this.canvas.on('selection:created', (e) => this._onSelectionChanged(e));
    this.canvas.on('selection:updated', (e) => this._onSelectionChanged(e));
    this.canvas.on('selection:cleared', () => {
      store.clearSelection();
    });

    this.canvas.on('object:modified', (e) => this._onObjectModified(e));
    this.canvas.on('object:moving', (e) => this._onObjectMoving(e));

    // Mouse wheel zoom
    this.canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      this.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      this._emitZoom();
    });

    // Middle mouse / alt+click panning
    this.canvas.on('mouse:down', (opt) => {
      if (opt.e.altKey || opt.e.button === 1) {
        this._isPanning = true;
        this._lastPanPos = { x: opt.e.clientX, y: opt.e.clientY };
        this.canvas.selection = false;
        this.canvas.setCursor('grabbing');
      }
    });

    this.canvas.on('mouse:move', (opt) => {
      if (this._isPanning && this._lastPanPos) {
        const vpt = this.canvas.viewportTransform;
        vpt[4] += opt.e.clientX - this._lastPanPos.x;
        vpt[5] += opt.e.clientY - this._lastPanPos.y;
        this._lastPanPos = { x: opt.e.clientX, y: opt.e.clientY };
        this.canvas.requestRenderAll();
      }
    });

    this.canvas.on('mouse:up', () => {
      if (this._isPanning) {
        this._isPanning = false;
        this._lastPanPos = null;
        this.canvas.selection = true;
        this.canvas.setCursor('default');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Resize handler
    window.addEventListener('resize', () => this.resize());

    // Listen for store events
    store.on('symbol:removed', ({ id }) => this._removeObject(id));
    store.on('symbol:updated', ({ id, symbol }) => this._updateObject(id, symbol));
  }

  _configureControls() {
    // Custom corner styling for Fabric v6
    const activeSelDefaults = {
      borderColor: '#cba6f7',
      cornerColor: '#cba6f7',
      cornerStrokeColor: '#1e1e2e',
      cornerSize: 8,
      cornerStyle: 'circle',
      transparentCorners: false,
      borderScaleFactor: 1.5,
      padding: 4,
    };
    // Apply to fabric defaults
    FabricImage.ownDefaults = { ...FabricImage.ownDefaults, ...activeSelDefaults };
  }

  /**
   * Add extracted images to the canvas in a grid layout.
   * @param {Array} symbols - Array of symbol data objects
   */
  async addSymbols(symbols) {
    let col = 0;
    let row = 0;
    let rowHeight = 0;
    let x = CELL_PADDING;
    let y = CELL_PADDING;

    for (const sym of symbols) {
      try {
        const img = await FabricImage.fromURL(sym.imageDataUrl, {}, {
          crossOrigin: 'anonymous',
        });

        // Scale to fit within a cell
        const scale = Math.min(
          MAX_THUMB_SIZE / img.width,
          MAX_THUMB_SIZE / img.height,
          1
        );
        img.set({
          left: x,
          top: y,
          scaleX: scale,
          scaleY: scale,
          // Custom data
          id: sym.id,
          // Fabric v6 controls
          borderColor: '#cba6f7',
          cornerColor: '#cba6f7',
          cornerStrokeColor: '#1e1e2e',
          cornerSize: 8,
          cornerStyle: 'circle',
          transparentCorners: false,
          padding: 4,
        });

        // Store reference
        img._symbolId = sym.id;
        this.objectMap.set(sym.id, img);
        this.canvas.add(img);

        // Update symbol with canvas position
        store.updateSymbol(sym.id, {
          canvas: {
            x: img.left,
            y: img.top,
            width: img.width * scale,
            height: img.height * scale,
            rotation: 0,
            scaleX: scale,
            scaleY: scale,
          },
        });

        // Grid layout
        const cellWidth = img.width * scale + CELL_PADDING;
        const cellHeight = img.height * scale + CELL_PADDING;
        rowHeight = Math.max(rowHeight, cellHeight);

        col++;
        x += cellWidth;

        if (col >= GRID_COLUMNS) {
          col = 0;
          row++;
          x = CELL_PADDING;
          y += rowHeight;
          rowHeight = 0;
        }
      } catch (err) {
        console.warn(`Failed to add symbol ${sym.id} to canvas:`, err);
      }
    }

    this.canvas.requestRenderAll();
    // Fit to view after adding all symbols
    setTimeout(() => this.fitToView(), 100);
  }

  /** Handle selection events */
  _onSelectionChanged(e) {
    const selected = this.canvas.getActiveObjects();
    store.clearSelection();
    for (const obj of selected) {
      if (obj._symbolId) {
        store.select(obj._symbolId, true);
      }
    }
  }

  /** Handle object modification (move, resize, rotate) */
  _onObjectModified(e) {
    const obj = e.target;
    if (!obj._symbolId) return;

    this._isModifying = true;
    store.updateSymbol(obj._symbolId, {
      canvas: {
        x: Math.round(obj.left),
        y: Math.round(obj.top),
        width: Math.round(obj.width * obj.scaleX),
        height: Math.round(obj.height * obj.scaleY),
        rotation: Math.round(obj.angle || 0),
        scaleX: obj.scaleX,
        scaleY: obj.scaleY,
      },
    });
    this._isModifying = false;
  }

  _onObjectMoving(e) {
    // Could add snap-to-grid here if needed
  }

  /** Select a specific object by symbol ID */
  selectById(id) {
    const obj = this.objectMap.get(id);
    if (obj) {
      this.canvas.setActiveObject(obj);
      this.canvas.requestRenderAll();
      // Pan to center the object
      this._panToObject(obj);
    }
  }

  _panToObject(obj) {
    const zoom = this.canvas.getZoom();
    const vpw = this.canvas.getWidth();
    const vph = this.canvas.getHeight();
    const objCenter = obj.getCenterPoint();
    const vpt = this.canvas.viewportTransform;
    vpt[4] = vpw / 2 - objCenter.x * zoom;
    vpt[5] = vph / 2 - objCenter.y * zoom;
    this.canvas.requestRenderAll();
  }

  /** Remove an object from canvas */
  _removeObject(id) {
    const obj = this.objectMap.get(id);
    if (obj) {
      this.canvas.remove(obj);
      this.objectMap.delete(id);
      this.canvas.requestRenderAll();
    }
  }

  /** Update canvas object from store (e.g. via property panel) */
  _updateObject(id, symbol) {
    if (this._isModifying) return; // Prevent loop if update came from canvas
    const obj = this.objectMap.get(id);
    if (!obj || !symbol.canvas) return;
    
    let changed = false;
    if (obj.left !== symbol.canvas.x) { obj.set('left', symbol.canvas.x); changed = true; }
    if (obj.top !== symbol.canvas.y) { obj.set('top', symbol.canvas.y); changed = true; }
    if (obj.angle !== symbol.canvas.rotation) { obj.set('angle', symbol.canvas.rotation); changed = true; }
    
    // Width and height changes affect scale
    const targetScaleX = symbol.canvas.width / obj.width;
    const targetScaleY = symbol.canvas.height / obj.height;
    
    if (Math.abs(obj.scaleX - targetScaleX) > 0.001) { obj.set('scaleX', targetScaleX); changed = true; }
    if (Math.abs(obj.scaleY - targetScaleY) > 0.001) { obj.set('scaleY', targetScaleY); changed = true; }
    
    if (changed) {
      obj.setCoords(); // Update bounding box
      this.canvas.requestRenderAll();
    }
  }

  // ── Zoom Controls ─────────────────────────────────────────

  zoomIn() {
    let zoom = this.canvas.getZoom() * 1.2;
    zoom = Math.min(MAX_ZOOM, zoom);
    const center = this.canvas.getCenterPoint();
    this.canvas.zoomToPoint(center, zoom);
    this._emitZoom();
  }

  zoomOut() {
    let zoom = this.canvas.getZoom() / 1.2;
    zoom = Math.max(MIN_ZOOM, zoom);
    const center = this.canvas.getCenterPoint();
    this.canvas.zoomToPoint(center, zoom);
    this._emitZoom();
  }

  fitToView() {
    const objects = this.canvas.getObjects();
    if (objects.length === 0) return;

    // Calculate bounding box of all objects
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const obj of objects) {
      const bound = obj.getBoundingRect();
      minX = Math.min(minX, bound.left);
      minY = Math.min(minY, bound.top);
      maxX = Math.max(maxX, bound.left + bound.width);
      maxY = Math.max(maxY, bound.top + bound.height);
    }

    const objWidth = maxX - minX;
    const objHeight = maxY - minY;
    const vpWidth = this.canvas.getWidth();
    const vpHeight = this.canvas.getHeight();

    const zoom = Math.min(
      (vpWidth - 60) / objWidth,
      (vpHeight - 60) / objHeight,
      2
    );

    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    this.canvas.zoomToPoint(center, zoom);

    // Center
    const vpt = this.canvas.viewportTransform;
    vpt[4] = vpWidth / 2 - center.x * zoom;
    vpt[5] = vpHeight / 2 - center.y * zoom;

    this.canvas.requestRenderAll();
    this._emitZoom();
  }

  _emitZoom() {
    const zoom = Math.round(this.canvas.getZoom() * 100);
    store.updateCanvasState({ zoom: this.canvas.getZoom() });
    store.emit('zoom:changed', zoom);
  }

  getZoomPercent() {
    return Math.round(this.canvas.getZoom() * 100);
  }

  // ── Keyboard Shortcuts ────────────────────────────────────

  _onKeyDown(e) {
    // Delete selected
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't trigger if user is typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      this.deleteSelected();
    }

    // Undo
    if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      store.emit('action:undo');
    }

    // Redo
    if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      store.emit('action:redo');
    }

    // Select all
    if (e.ctrlKey && e.key === 'a') {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this.selectAll();
    }
  }

  deleteSelected() {
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;

    for (const obj of active) {
      if (obj._symbolId) {
        store.removeSymbol(obj._symbolId);
      }
    }
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  selectAll() {
    const objects = this.canvas.getObjects();
    if (objects.length === 0) return;
    if (objects.length === 1) {
      this.canvas.setActiveObject(objects[0]);
    } else {
      const sel = new ActiveSelection(objects, { canvas: this.canvas });
      this.canvas.setActiveObject(sel);
    }
    this.canvas.requestRenderAll();
  }

  // ── Resize ────────────────────────────────────────────────

  resize() {
    const container = document.getElementById('canvas-area');
    if (!container || !this.canvas) return;
    this.canvas.setDimensions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.canvas.requestRenderAll();
  }

  // ── Clear ─────────────────────────────────────────────────

  clear() {
    if (!this.canvas) return;
    this.canvas.clear();
    this.objectMap.clear();
  }
}

export const canvasManager = new CanvasManager();
