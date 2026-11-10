import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowForward } from 'ionicons/icons';
import { formatAmount, formatMoney } from '../../core/money';
import { i18n } from '../../i18n';
import { Logo } from '../../shell/logo';

@Component({
  selector: 'app-welcome',
  imports: [RouterLink, IonContent, IonIcon, Logo],
  templateUrl: './welcome.page.html',
  styleUrl: './welcome.page.scss',
})
export class WelcomePage {
  protected readonly t = i18n;
  protected readonly step = signal(0);
  protected readonly formatMoney = formatMoney;
  // Суммы только для иллюстраций; 3 × 416,20 = 1 248,60.
  protected readonly sampleShared = `${formatAmount(1843000, { trimZero: true })} ${i18n.currency}`;
  protected readonly sampleOwed = `+${formatAmount(128500, { trimZero: true })} ${i18n.currency}`;

  constructor() {
    addIcons({ arrowForward });
  }
}
