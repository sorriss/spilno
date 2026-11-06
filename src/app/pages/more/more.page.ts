import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronForward, peopleOutline } from 'ionicons/icons';
import { uk } from '../../i18n/uk';
import { signOut } from '../family-setup/family-setup.data';

/** Пока только то, что уже работает; остальные разделы добавим вместе с их экранами. */
@Component({
  selector: 'app-more',
  imports: [RouterLink, IonContent, IonIcon],
  template: `
    <ion-content>
      <main class="flow">
        <div class="copy"><h1>{{ t.more.title }}</h1></div>
        <a class="row" routerLink="/tabs/more/family">
          <ion-icon name="people-outline" aria-hidden="true" />
          <span>{{ t.more.family }}</span>
          <ion-icon name="chevron-forward" aria-hidden="true" />
        </a>
        @if (error()) {
          <p class="form-error" role="alert">{{ error() }}</p>
        }
        <button type="button" class="link-button" (click)="leave()">{{ t.signOut }}</button>
      </main>
    </ion-content>
  `,
  styles: `
    .row {
      display: flex;
      align-items: center;
      gap: var(--sp-space-3);
      min-height: 52px;
      padding: 0 var(--sp-space-4);
      border-radius: var(--sp-radius-card);
      background: var(--sp-surface);
      color: var(--sp-text);
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
    }
    .row span {
      flex: 1;
    }
  `,
})
export class MorePage {
  private readonly nav = inject(NavController);

  protected readonly t = uk;
  protected readonly error = signal('');

  constructor() {
    addIcons({ chevronForward, peopleOutline });
  }

  protected async leave(): Promise<void> {
    try {
      await signOut();
      await this.nav.navigateRoot('/welcome');
    } catch {
      this.error.set(uk.more.signOutError);
    }
  }
}
