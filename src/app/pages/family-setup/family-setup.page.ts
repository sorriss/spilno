import { Component, inject, signal } from '@angular/core';
import { IonContent, IonIcon, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, enterOutline } from 'ionicons/icons';
import { i18n } from '../../i18n';
import { createFamily, familyErrorMessage, joinFamily, signOut } from './family-setup.data';

@Component({
  selector: 'app-family-setup',
  imports: [IonContent, IonIcon],
  templateUrl: './family-setup.page.html',
  styleUrl: './family-setup.page.scss',
})
export class FamilySetupPage {
  private readonly nav = inject(NavController);

  protected readonly t = i18n;
  protected readonly joining = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    addIcons({ add, enterOutline });
  }

  protected pick(joining: boolean): void {
    this.joining.set(joining);
    this.error.set('');
  }

  protected async submit(form: HTMLFormElement): Promise<void> {
    if (this.busy()) return;
    const data = new FormData(form);
    const value = (key: string) => ((data.get(key) as string | null) ?? '').trim();
    // Пробелы проходят native required, а имя из пробелов в БД не нужно.
    const memberName = value('memberName');
    const other = value(this.joining() ? 'inviteCode' : 'familyName');
    if (!memberName || !other) {
      this.error.set(i18n.familySetup.errorEmpty);
      return;
    }

    this.busy.set(true);
    this.error.set('');
    try {
      await (this.joining() ? joinFamily(other, memberName) : createFamily(other, memberName));
      await this.nav.navigateRoot('/tabs/overview');
    } catch (e) {
      this.error.set(familyErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async leave(): Promise<void> {
    try {
      await signOut();
      await this.nav.navigateRoot('/welcome');
    } catch (e) {
      this.error.set(familyErrorMessage(e));
    }
  }
}
