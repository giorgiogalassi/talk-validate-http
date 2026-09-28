import { Component, inject } from '@angular/core';
import { FormField } from '@angular/forms/signals';
import { LookupLog } from './spike/lookup-log';
import { VARIANTS, createUsernameForm } from './spike/username-form';

@Component({
  selector: 'app-root',
  imports: [FormField],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly log = inject(LookupLog);
  protected readonly variants = VARIANTS;
  protected readonly f = createUsernameForm().form;
}
