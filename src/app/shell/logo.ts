import { Component } from '@angular/core';

/** Знак Spilno; размер задаёт родитель шириной элемента app-logo. */
@Component({
  selector: 'app-logo',
  template: `
    <svg viewBox="0 0 30 22" aria-hidden="true">
      <circle cx="11" cy="11" r="10" fill="var(--ion-color-primary)" />
      <circle cx="19" cy="11" r="10" fill="var(--sp-logo-back)" fill-opacity="0.85" />
    </svg>
  `,
  styles: ':host { display: block; } svg { display: block; width: 100%; }',
})
export class Logo {}
