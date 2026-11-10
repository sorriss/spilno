import { Component, OnDestroy, inject, signal } from '@angular/core';
import { IonContent, IonIcon, NavController } from '@ionic/angular';
import { RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import { chevronBack } from 'ionicons/icons';
import { i18n } from '../../i18n';
import { Logo } from '../../shell/logo';
import { sendCode, signInErrorMessage, verifyCode } from './sign-in.data';

const RESEND_SECONDS = 45;

@Component({
  selector: 'app-sign-in',
  imports: [IonContent, IonIcon, Logo, RouterLink],
  templateUrl: './sign-in.page.html',
  styles: `
    app-logo { width: 52px; }
    .terms { font-size: 12px; line-height: 16px; color: var(--sp-text-secondary); text-align: center; }
    .terms a { color: var(--ion-color-primary); }
  `,
})
export class SignInPage implements OnDestroy {
  private readonly nav = inject(NavController);
  private timer?: ReturnType<typeof setInterval>;

  protected readonly t = i18n;
  protected readonly email = signal('');
  protected readonly codeSent = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly resendIn = signal(0);

  constructor() {
    addIcons({ chevronBack });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected back(): void {
    this.error.set('');
    if (this.codeSent()) this.codeSent.set(false);
    else this.nav.navigateBack('/welcome');
  }

  protected async send(): Promise<void> {
    if (await this.attempt(() => sendCode(this.email().trim()))) {
      this.codeSent.set(true);
      this.startResendTimer();
    }
  }

  protected async verify(form: HTMLFormElement): Promise<void> {
    const token = new FormData(form).get('code') as string;
    if (await this.attempt(() => verifyCode(this.email().trim(), token))) {
      await this.nav.navigateRoot('/tabs/overview'); // familyGuard сам отправит на /family-setup, если семьи нет.
    }
  }

  protected digitsOnly(input: HTMLInputElement): void {
    input.value = input.value.replace(/\D/g, '');
  }

  private async attempt(action: () => Promise<void>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      return true;
    } catch (e) {
      this.error.set(signInErrorMessage(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private startResendTimer(): void {
    clearInterval(this.timer);
    this.resendIn.set(RESEND_SECONDS);
    this.timer = setInterval(() => {
      this.resendIn.update((s) => s - 1);
      if (this.resendIn() <= 0) clearInterval(this.timer);
    }, 1000);
  }
}
