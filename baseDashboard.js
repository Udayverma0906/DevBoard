'use strict';

class BaseDashboard {
  constructor(wrapperId) {
    this._wrap    = document.getElementById(wrapperId);
    this._widgets = [];
    this._grid    = document.createElement('div');
    this._grid.className = 'dash-grid';
    this._wrap.appendChild(this._grid);
  }

  register(widget) {
    this._widgets.push(widget);
    this._grid.appendChild(widget.el);
    return this;
  }

  refresh(data) {
    this._widgets.forEach(w => w.refresh(data));
  }

  show() { this._wrap.style.display = ''; }
  hide() { this._wrap.style.display = 'none'; }
}
