import { Component, inject, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { i18n } from '../../i18n';
import { askConfirm, askName } from '../../shell/ask-name';
import { Account, AccountKind, addAccount, AccountsView, loadAccounts, updateAccount } from './accounts.data';

/** ponytail: только название и видимость; остаток на счёте посчитаем, когда появится импорт монобанка. */
@Component({
  selector: 'app-accounts',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="page">
        @if (view.hasValue()) {
          @let v = view.value();
          @if (error()) {
            <p class="form-error" role="alert">{{ error() }}</p>
          }

          <section class="tx-list">
            @for (a of v.mine; track a.id) {
              <div class="item">
                <div class="line">
                  <span class="text">
                    <strong>{{ a.name }}</strong>
                    <small>{{ s.kinds[a.kind] }}</small>
                  </span>
                  @if (v.canEdit) {
                    <button type="button" class="link-button" [disabled]="busy()" (click)="rename(a)">{{ s.rename }}</button>
                    <button type="button" class="link-button danger" [disabled]="busy()" (click)="archive(a)">{{ s.archive }}</button>
                  }
                </div>
                @if (v.canEdit) {
                  <label class="switch">
                    <span><small>{{ s.visible }}</small></span>
                    <input
                      type="checkbox"
                      role="switch"
                      [checked]="a.visible"
                      [disabled]="busy()"
                      (change)="setVisible(a, $any($event.target).checked)"
                    />
                  </label>
                }
              </div>
            } @empty {
              <p class="state">{{ s.empty }}</p>
            }
          </section>

          @if (v.canEdit) {
            <form #form class="form card" (submit)="$event.preventDefault(); add(v, form)">
              <h2>{{ s.addTitle }}</h2>
              <label for="accountName">{{ s.nameLabel }}</label>
              <input id="accountName" name="name" class="input" maxlength="60" [placeholder]="s.namePlaceholder" />
              <div class="segment" role="group" [attr.aria-label]="s.kindLabel">
                @for (k of kinds; track k) {
                  <button type="button" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ s.kinds[k] }}</button>
                }
              </div>
              <button type="submit" class="cta" [disabled]="busy()">{{ s.add }}</button>
            </form>
          }

          @if (v.others.length) {
            <h2>{{ s.others }}</h2>
            <section class="tx-list">
              @for (a of v.others; track a.id) {
                <div class="item">
                  <span class="text">
                    <strong>{{ a.name }}</strong>
                    <small>{{ a.ownerName }} · {{ s.kinds[a.kind] }}</small>
                  </span>
                </div>
              }
            </section>
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
    .page {
      display: flex;
      flex-direction: column;
      gap: var(--sp-space-3);
      max-width: var(--sp-page-width);
      margin: 0 auto;
      padding: var(--sp-space-3) var(--sp-space-5) var(--sp-space-5);
    }
    h2 {
      margin: 0;
      font-size: 17px;
      line-height: 24px;
      font-weight: 800;
    }
    .card {
      padding: var(--sp-space-4);
      border-radius: var(--sp-radius-card);
      background: var(--sp-surface);
    }
    .item {
      padding: var(--sp-space-2) 0;
    }
    .item + .item {
      border-top: 1px solid var(--sp-divider);
    }
    .line {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 44px;
      justify-content: center;
      overflow-wrap: anywhere;
    }
    strong {
      font-size: 15px;
      line-height: 20px;
      font-weight: 700;
    }
    small {
      font-size: 12px;
      line-height: 16px;
      color: var(--sp-text-secondary);
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
export class AccountsPage {
  private readonly alerts = inject(AlertController);

  protected readonly t = i18n;
  protected readonly s = i18n.accounts;
  protected readonly kinds: AccountKind[] = ['cash', 'card'];
  protected readonly kind = signal<AccountKind>('card');
  protected readonly view = resource({ loader: loadAccounts });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async add(v: AccountsView, form: HTMLFormElement): Promise<void> {
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) {
      this.error.set(this.s.errorEmpty);
      return;
    }
    if (await this.run(() => addAccount(v.familyId, v.meId, name, this.kind(), false))) form.reset();
  }

  protected rename(a: Account): Promise<void> {
    return askName(this.alerts, this.s.renameTitle, a.name, (name) => void this.run(() => updateAccount(a.id, { name })));
  }

  protected setVisible(a: Account, visible: boolean): void {
    void this.run(() => updateAccount(a.id, { is_visible_to_family: visible }));
  }

  protected archive(a: Account): Promise<void> {
    return askConfirm(this.alerts, this.s.archiveTitle, this.s.archiveHint(a.name), this.s.archive, () =>
      void this.run(() => updateAccount(a.id, { archived_at: new Date().toISOString() })),
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
      this.view.reload(); // переключатель уже сдвинулся: возвращаем его к значению из базы
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
