import { Component, computed, inject, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { i18n } from '../../i18n';
import { askConfirm, askName } from '../../shell/ask-name';
import { addCategory, CategoriesView, Category, CategoryKind, loadCategories, updateCategory } from './categories.data';
import { addIcons } from 'ionicons';
import { CATEGORY_ICONS } from '../../shell/tx-row';

@Component({
  selector: 'app-categories',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, IonIcon],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        <div class="segment" role="group" [attr.aria-label]="s.kindLabel">
          @for (k of kinds; track k) {
            <button type="button" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ s.kinds[k] }}</button>
          }
        </div>

        @if (view.hasValue()) {
          @let v = view.value();
          @if (error()) {
            <p class="form-error" role="alert">{{ error() }}</p>
          }
          @if (v.canEdit) {
            <form #form class="add" (submit)="$event.preventDefault(); add(v, form)">
              <input name="name" class="input" maxlength="60" [attr.aria-label]="s.nameLabel" [placeholder]="s.nameLabel" />
              <button type="submit" class="cta" [disabled]="busy()">{{ s.add }}</button>
            </form>
          }
          <section class="tx-list">
            @for (c of shown(); track c.id) {
              <div class="item">
                <span class="icon tone-{{ c.colorIndex }}"><ion-icon [name]="c.icon" aria-hidden="true" /></span>
                <span class="name">{{ c.name }}</span>
                @if (v.canEdit) {
                  <button type="button" class="link-button" [disabled]="busy()" (click)="rename(c)">{{ s.rename }}</button>
                  <button type="button" class="link-button danger" [disabled]="busy()" (click)="archive(c)">{{ s.archive }}</button>
                }
              </div>
            } @empty {
              <p class="state">{{ s.empty }}</p>
            }
          </section>
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
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-3);
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: var(--sp-space-3) var(--sp-space-5) var(--sp-space-5);
    }
    .add {
      display: flex;
      gap: var(--sp-space-2);
    }
    .add .input {
      flex: 1;
      min-width: 0;
    }
    .add .cta {
      flex: none;
      padding: 0 var(--sp-space-4);
    }
    .item {
      display: flex;
      align-items: center;
      gap: var(--sp-space-2);
      min-height: 56px;
    }
    .item + .item {
      border-top: 1px solid var(--sp-divider);
    }
    .icon {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: var(--sp-radius-button);
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 20px;
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .link-button {
      font-size: 13px;
    }
    .danger {
      color: var(--sp-you-owe);
    }
    .state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-space-3);
      margin: 0;
      padding: var(--sp-space-5);
      font-size: 14px;
      color: var(--sp-text-secondary);
      text-align: center;
    }
    .state p {
      margin: 0;
    }
  `,
})
export class CategoriesPage {
  private readonly alerts = inject(AlertController);

  protected readonly t = i18n;
  protected readonly s = i18n.categories;
  protected readonly kinds: CategoryKind[] = ['expense', 'income'];
  protected readonly kind = signal<CategoryKind>('expense');
  protected readonly view = resource({ loader: loadCategories });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly shown = computed(() =>
    (this.view.hasValue() ? this.view.value().categories : []).filter((c) => c.kind === this.kind()),
  );

  constructor() {
    addIcons(CATEGORY_ICONS);
  }

  protected async add(v: CategoriesView, form: HTMLFormElement): Promise<void> {
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) {
      this.error.set(this.s.errorEmpty);
      return;
    }
    if (await this.run(() => addCategory(v.familyId, name, this.kind(), v.categories.length))) form.reset();
  }

  protected rename(c: Category): Promise<void> {
    return askName(this.alerts, this.s.renameTitle, c.name, (name) => void this.run(() => updateCategory(c.id, { name })));
  }

  protected archive(c: Category): Promise<void> {
    return askConfirm(this.alerts, this.s.archiveTitle, this.s.archiveHint(c.name), this.s.archive, () =>
      void this.run(() => updateCategory(c.id, { archived_at: new Date().toISOString() })),
    );
  }

  private async run(action: () => Promise<void>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      this.view.reload();
      return true;
    } catch {
      this.error.set(this.s.errorSave);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
