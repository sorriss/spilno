import { Component, resource, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { trashOutline } from 'ionicons/icons';
import { uk } from '../../i18n/uk';
import { addRule, deleteRule, loadRules, Rule, RulesView } from './rules.data';

type Kind = 'category' | 'merchant';

@Component({
  selector: 'app-rules',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, IonIcon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="flow">
        <p class="hint">{{ s.intro }}</p>
        @if (view.hasValue()) {
          @let v = view.value();
          @if (v.rules.length) {
            <ul class="tx-list">
              @for (r of v.rules; track r.id) {
                <li>
                  <span class="text">
                    <strong>{{ r.category ?? s.merchantLabel(r.merchant!) }}</strong>
                    <small>{{ who(v, r) }}</small>
                  </span>
                  <button type="button" class="round-button" [attr.aria-label]="s.delete" [disabled]="busy()" (click)="remove(r.id)">
                    <ion-icon name="trash-outline" aria-hidden="true" />
                  </button>
                </li>
              }
            </ul>
          }

          @if (v.role === 'viewer') {
            <p class="hint">{{ s.viewerOnly }}</p>
          } @else {
            <form #form class="form" (submit)="$event.preventDefault(); add(v, form)">
              <h2>{{ s.newRule }}</h2>
              <div class="segment" role="group" [attr.aria-label]="s.kindLabel">
                <button type="button" [attr.aria-pressed]="kind() === 'category'" (click)="kind.set('category')">{{ s.byCategory }}</button>
                <button type="button" [attr.aria-pressed]="kind() === 'merchant'" (click)="kind.set('merchant')">{{ s.byMerchant }}</button>
              </div>
              @if (kind() === 'category') {
                <label for="category">{{ s.categoryLabel }}</label>
                <select id="category" name="category" class="input" required>
                  @for (c of v.categories; track c.id) {
                    <option [value]="c.id">{{ c.name }}</option>
                  }
                </select>
              } @else {
                <label for="merchant">{{ s.merchantInput }}</label>
                <input id="merchant" name="merchant" class="input" maxlength="60" required [placeholder]="s.merchantPlaceholder" />
              }
              <span class="label">{{ s.splitBetween }}</span>
              <div class="chips">
                @for (m of v.members; track m.id) {
                  <button type="button" class="chip" [attr.aria-pressed]="!excluded().has(m.id)" (click)="toggle(m.id)">
                    <span class="avatar tone-{{ m.colorIndex }}" aria-hidden="true">{{ m.name[0] }}</span>
                    {{ m.id === v.meId ? t.you : m.name }}
                  </button>
                }
              </div>
              @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
              }
              <button type="submit" class="cta" [disabled]="busy()">{{ s.add }}</button>
            </form>
          }
        } @else if (view.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="view.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .hint {
      margin: 0;
      font-size: 13px;
      line-height: 18px;
      color: var(--sp-text-secondary);
    }
    h2 {
      margin: 0;
      font-size: 17px;
      line-height: 24px;
      font-weight: 800;
    }
    ul {
      margin: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 56px;
    }
    li + li {
      border-top: 1px solid var(--sp-divider);
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .text small,
    .label {
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-space-3);
      padding: var(--sp-space-5);
      font-size: 14px;
    }
    .state p {
      margin: 0;
    }
  `,
})
export class RulesPage {
  protected readonly t = uk;
  protected readonly s = uk.rules;
  protected readonly view = resource({ loader: loadRules });
  protected readonly kind = signal<Kind>('category');
  /** Кого не делить; по умолчанию делим на всех. */
  protected readonly excluded = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    addIcons({ trashOutline });
  }

  protected who(v: RulesView, r: Rule): string {
    if (!r.memberIds) return this.s.wholeFamily;
    return v.members
      .filter((m) => r.memberIds!.includes(m.id))
      .map((m) => (m.id === v.meId ? this.t.you : m.name))
      .join(', ');
  }

  protected toggle(id: string): void {
    this.excluded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async add(v: RulesView, form: HTMLFormElement): Promise<void> {
    if (this.busy()) return;
    const data = new FormData(form);
    const merchant = String(data.get('merchant') ?? '').trim();
    const categoryId = String(data.get('category') ?? '');
    const people = v.members.filter((m) => !this.excluded().has(m.id)).map((m) => m.id);
    if (this.kind() === 'merchant' && merchant.length < 2) return this.error.set(this.s.errorMerchant);
    if (this.kind() === 'category' && !categoryId) return this.error.set(this.s.errorCategory);
    if (!people.length) return this.error.set(this.s.errorMembers);

    this.busy.set(true);
    this.error.set('');
    try {
      await addRule({
        familyId: v.familyId,
        meId: v.meId,
        categoryId: this.kind() === 'category' ? categoryId : null,
        merchant: this.kind() === 'merchant' ? merchant : null,
        memberIds: people.length === v.members.length ? null : people,
      });
      form.reset();
      this.excluded.set(new Set());
      this.view.reload();
    } catch {
      this.error.set(this.s.errorSave);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(id: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await deleteRule(id);
      this.view.reload();
    } catch {
      this.error.set(this.s.errorSave);
    } finally {
      this.busy.set(false);
    }
  }
}
