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

class ConfirmPopup extends BasePopup {
  constructor() {
    const id = 'confirmOverlay';
    if (!document.getElementById(id)) {
      const el = document.createElement('div');
      el.id = id;
      el.className = 'overlay';
      el.innerHTML = `
        <div class="modal modal-sm" role="dialog" aria-modal="true">
          <div class="modal-head">
            <span class="modal-title" id="confirmTitle">Confirm</span>
            <button class="modal-close" id="confirmClose" aria-label="Close">✕</button>
          </div>
          <div class="modal-body">
            <p class="confirm-msg" id="confirmMsg"></p>
          </div>
          <div class="modal-foot">
            <button class="btn-ghost" id="confirmCancel">Cancel</button>
            <button id="confirmOk">Confirm</button>
          </div>
        </div>`;
      document.body.appendChild(el);
    }
    super(id);
    this._okBtn     = document.getElementById('confirmOk');
    this._onConfirm = null;
    document.getElementById('confirmClose').addEventListener('click',  () => this.close());
    document.getElementById('confirmCancel').addEventListener('click', () => this.close());
    this._okBtn.addEventListener('click', () => {
      if (this._onConfirm) this._onConfirm();
      this.close();
    });
  }

  ask({ title = 'Confirm', message, okLabel = 'Confirm', okClass = 'btn-danger', onConfirm }) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent   = message;
    this._okBtn.textContent = okLabel;
    this._okBtn.className   = okClass;
    this._onConfirm = onConfirm;
    this.open('#confirmOk');
  }
}
