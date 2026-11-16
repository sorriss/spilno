import { Component, inject, resource, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar, NavController,
} from '@ionic/angular';
import { currentMember } from '../../core/family';
import { supabase } from '../../core/supabase';
import { i18n } from '../../i18n';
import { normalizePayLink } from '../settle/settle.data';

async function loadProfile() {
  const db = supabase!;
  const me = await currentMember();
  const [{ data: auth }, member] = await Promise.all([
    db.auth.getUser(),
    db.from('family_members').select('display_name, color_index, mono_pay_link').eq('id', me.id).single(),
  ]);
  if (member.error) throw member.error;
  return {
    familyId: me.familyId,
    name: member.data.display_name as string,
    color: member.data.color_index as number,
    payLink: (member.data.mono_pay_link as string | null) ?? '',
    email: auth.user?.email ?? '',
  };
}

@Component({
  selector: 'app-profile',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more" [text]="''" /></ion-buttons>
        <ion-title>{{ s.title }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <main class="flow">
        @if (profile.hasValue()) {
          @let p = profile.value();
          <form #form class="form" (submit)="$event.preventDefault(); save(p.familyId, form)">
            <label for="name">{{ s.nameLabel }}</label>
            <input id="name" name="name" class="input" maxlength="60" required [value]="p.name" />
            <p class="hint">{{ s.nameHint }}</p>
            <fieldset class="colors">
              <legend>{{ s.colorLabel }}</legend>
              @for (c of s.colorNames; track $index) {
                <label class="color tone-{{ $index }}">
                  <input type="radio" name="color" [value]="$index" [checked]="$index === p.color" [attr.aria-label]="c" />
                  <span aria-hidden="true">{{ p.name[0] }}</span>
                </label>
              }
            </fieldset>
            <label for="payLink">{{ s.payLinkLabel }}</label>
            <input
              id="payLink"
              name="payLink"
              class="input"
              inputmode="url"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="https://send.monobank.ua/…"
              [value]="p.payLink"
            />
            <p class="hint">{{ s.payLinkHint }}</p>
            <label for="email">{{ s.emailLabel }}</label>
            <input id="email" class="input" readonly [value]="p.email" />
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
            <button type="submit" class="cta" [disabled]="busy()">{{ t.save }}</button>
          </form>
        } @else if (profile.error()) {
          <section class="state">
            <p>{{ s.loadError }}</p>
            <ion-button (click)="profile.reload()">{{ t.retry }}</ion-button>
          </section>
        } @else {
          <div class="state"><ion-spinner /></div>
        }
      </main>
    </ion-content>
  `,
  styles: `
    .colors {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sp-space-3);
      margin: 0 0 var(--sp-space-3);
      padding: 0;
      border: 0;
    }
    .colors legend {
      margin-bottom: var(--sp-space-2);
      padding: 0;
      font-size: 13px;
      font-weight: 700;
    }
    .color {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--tone-bg);
      color: var(--tone-fg);
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
    }
    .color input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    .color:has(input:checked) {
      box-shadow: 0 0 0 2px var(--ion-background-color), 0 0 0 4px var(--tone-fg);
    }
    .color:has(input:focus-visible) {
      outline: 2px solid var(--ion-color-primary);
      outline-offset: 4px;
    }
    .hint {
      margin: 0 0 var(--sp-space-2);
      font-size: 13px;
      line-height: 18px;
      color: var(--sp-text-secondary);
    }
    input[readonly] {
      background: var(--sp-divider);
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
export class ProfilePage {
  private readonly nav = inject(NavController);

  protected readonly t = i18n;
  protected readonly s = i18n.profile;
  protected readonly profile = resource({ loader: loadProfile });
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async save(familyId: string, form: HTMLFormElement): Promise<void> {
    if (this.busy()) return;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const color = Number(data.get('color'));
    const rawLink = String(data.get('payLink') ?? '').trim();
    const payLink = rawLink ? normalizePayLink(rawLink) : '';
    if (!name) {
      this.error.set(this.s.errorEmpty);
      return;
    }
    if (payLink === null) {
      this.error.set(this.s.errorPayLink);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const [renamed, linked, colored] = await Promise.all([
        supabase!.rpc('rename_me', { fam: familyId, member_name: name }),
        supabase!.rpc('set_pay_link', { fam: familyId, link: payLink }),
        supabase!.rpc('set_my_color', { fam: familyId, color }),
      ]);
      const error = renamed.error ?? linked.error ?? colored.error;
      if (error) throw error;
      await this.nav.navigateBack('/tabs/more');
    } catch {
      this.error.set(this.s.errorSave);
    } finally {
      this.busy.set(false);
    }
  }
}
