import { Component, inject, resource, signal } from '@angular/core';
import {
  AlertController, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import { MemberRole } from '../../core/family';
import { formatMoney } from '../../core/money';
import { askConfirm } from '../../shell/ask-name';
import { uk } from '../../i18n/uk';
import { FamilyView, Invite, createInvite, loadFamily, removeMember, setMemberRole } from './family.data';

@Component({
  selector: 'app-family',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonSpinner, IonButton, IonIcon],
  templateUrl: './family.page.html',
  styleUrl: './family.page.scss',
})
export class FamilyPage {
  protected readonly t = uk;
  protected readonly canShare = typeof navigator.share === 'function';
  protected readonly family = resource({ loader: loadFamily });
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly memberError = signal('');
  /** Передачу владения пока не делаем: у семьи всегда один владелец. */
  protected readonly roles: MemberRole[] = ['member', 'viewer'];

  private readonly alerts = inject(AlertController);

  constructor() {
    addIcons({ close });
  }

  /** Страница живёт в стеке Ionic: пока вы были в другом месте, код могли использовать, а участник — вступить. */
  ionViewWillEnter(): void {
    this.family.reload();
  }

  protected changeRole(id: string, role: MemberRole): Promise<void> {
    return this.runMember(() => setMemberRole(id, role));
  }

  /** С ненулевым балансом удалить нельзя: вышедший теряет доступ и не сможет подтвердить или закрыть расчёт. */
  protected remove(m: FamilyView['members'][number]): Promise<void> {
    this.memberError.set('');
    if (m.balance !== 0) {
      this.memberError.set(uk.family.removeHasBalance(m.name, formatMoney(m.balance, { plus: true })));
      return Promise.resolve();
    }
    return askConfirm(this.alerts, uk.family.removeTitle, uk.family.removeHint(m.name), uk.family.remove, () =>
      void this.runMember(() => removeMember(m.id)),
    );
  }

  private async runMember(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.memberError.set('');
    try {
      await action();
    } catch {
      this.memberError.set(uk.family.saveError);
    } finally {
      this.busy.set(false);
      this.family.reload(); // в том числе возвращает выпадающий список к значению из базы
    }
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
