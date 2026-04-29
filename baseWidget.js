'use strict';

class BaseWidget {
  constructor({ id, title, cols = 2 }) {
    this.id   = id;
    this.cols = cols;

    this.el = document.createElement('div');
    this.el.className    = 'widget';
    this.el.id           = `widget-${id}`;
    this.el.dataset.wCols = cols;

    const head = document.createElement('div');
    head.className   = 'widget-head';
    head.textContent = title;

    this._body = document.createElement('div');
    this._body.className = 'widget-body';

    this.el.append(head, this._body);
  }

  // Subclasses override — receives data object, returns a DOM Node
  render(_data) {
    return document.createTextNode('—');
  }

  refresh(data) {
    this._body.innerHTML = '';
    const node = this.render(data);
    if (node instanceof Node) this._body.appendChild(node);
  }
}
