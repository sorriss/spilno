import { Component, resource, signal } from '@angular/core';
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { uk } from '../../i18n/uk';
import { Invite, createInvite, loadFamily } from './family.data';

@Component({
  selector: 'app-family',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton],
  templateUrl: './family.page.html',
  styleUrl: './family.page.scss',
})
export class FamilyPage {
  protected readonly t = uk;
  protected readonly canShare = typeof navigator.share === 'function';
  protected readonly family = resource({ loader: loadFamily });
  protected readonly busy = signal(false);
  protected readonly notice = signal('');

  /** Страница живёт в стеке Ionic: пока вы были в другом месте, код могли использовать, а участник — вступить. */
  ionViewWillEnter(): void {
    this.family.reload();
  }

  protected expires(invite: Invite): string {
    const date = invite.expiresAt.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
    return uk.family.inviteExpires(date);
  }

  protected async create(familyId: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set('');
    try {
      await createInvite(familyId);
      this.family.reload();
    } catch {
      this.notice.set(uk.family.inviteError);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.notice.set(uk.family.copied);
    } catch {
      this.notice.set(uk.family.copyError);
    }
  }

  protected async share(code: string, familyName: string): Promise<void> {
    try {
      await navigator.share({ text: uk.family.shareText(familyName, code) });
    } catch (e) {
      // AbortError: пользователь сам закрыл окно «Поделиться».
      if ((e as Error).name !== 'AbortError') this.notice.set(uk.family.copyError);
    }
  }
}
