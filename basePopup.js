'use strict';

class BasePopup {
  constructor(overlayId) {
    this._el    = document.getElementById(overlayId);
    this._keyFn = e => { if (e.key === 'Escape') this.close(); };

    this._el.addEventListener('click', e => {
      if (e.target === this._el) this.close();
    });
  }

  open(focusSelector) {
    this._el.classList.add('open');
    document.addEventListener('keydown', this._keyFn);
    const target = focusSelector
      ? this._el.querySelector(focusSelector)
      : this._el.querySelector('input, textarea');
    if (target) setTimeout(() => target.focus(), 50);
  }

  close() {
    this._el.classList.remove('open');
    document.removeEventListener('keydown', this._keyFn);
  }

  get isOpen() {
    return this._el.classList.contains('open');
  }
}
