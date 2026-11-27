import { Component, OnInit, Inject } from '@angular/core';
import { MatFormField, MatError, MatFormFieldModule } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatLabel } from '@angular/material/form-field';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { AbstractControl, FormControl, ReactiveFormsModule, FormGroup, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { NgFor, AsyncPipe, NgIf, CommonModule } from '@angular/common';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { AccountInfo } from '@azure/msal-browser';
import { DesktopAuthService } from 'src/app/services/desktop-auth.service';
import { NotificationService } from 'src/app/services/notification.service';
import { isSameEnvironment, parseEnvironmentUrl } from 'src/app/services/environment-url';

function environmentUrlValidator(control: AbstractControl<string>): ValidationErrors | null {
  // An empty field is reported by the required validator
  return !control.value || parseEnvironmentUrl(control.value)
    ? null
    : { urlFormat: 'Enter an address such as org.crm.dynamics.com' };
}

@Component({
  selector: 'app-connections-desktop',
  templateUrl: './connections-desktop.component.html',
  styleUrls: ['./connections-desktop.component.css'],
  standalone: true,
  imports: [
    MatFormField, 
    MatInput, 
    MatButton, 
    MatLabel, 
    ReactiveFormsModule, 
    MatProgressSpinner,
    MatListModule,
    NgFor,
    AsyncPipe,
    MatError,
    MatFormFieldModule,
    NgIf,
    CommonModule,
    MatSnackBarModule,
    MatDialogModule
  ]
})
export class ConnectionsDesktopComponent implements OnInit {

  constructor(private dialogRef: MatDialogRef<ConnectionsDesktopComponent>,
    private fb: FormBuilder,
    private notificationService: NotificationService,
    private authService: DesktopAuthService,
    @Inject(ACTIVE_ACCOUNT_MODEL) private activeAccount: BehaviorSubject<AccountInfo>,
    @Inject(ACTIVE_ENVIRONMENT_MODEL) private _activeEnvironmentModel: BehaviorSubject<EnvironmentModel>) { }

  environments$: BehaviorSubject<EnvironmentModel[]> = new BehaviorSubject<EnvironmentModel[]>([]);
  isLoading = false;
  isFormActive = false;
  selectedEnvironment: EnvironmentModel | null = null;
  
  environmentForm = new FormGroup({
    environmentUrl: new FormControl('', [Validators.required, environmentUrlValidator]),
    friendlyName: new FormControl('My Environment', [Validators.required, Validators.minLength(1), Validators.maxLength(50)])
  });
  
  ngOnInit() {
    this.isLoading = true;
    
    this.dialogRef.updateSize();
    
    this.authService.getEnvironments().subscribe(environments => {
      this.environments$.next(environments);
      this.isLoading = false;
    });
  }

  updateFormActiveState() {
    if (this.environmentForm.dirty) {
      this.isFormActive = true;
    } else if (!this.selectedEnvironment) {
      this.isFormActive = this.environmentForm.dirty;
    }
  }
  

  createEnvironmentModel(url: string, friendlyName: string): EnvironmentModel {
    return { ...parseEnvironmentUrl(url), friendlyName: friendlyName };
  }

  connectToEnvironment() {
    if (this.selectedEnvironment) {
      // If an environment is selected, use that environment
      const current = this._activeEnvironmentModel.value;

      if (!current || !isSameEnvironment(current, this.selectedEnvironment)) {
        try {
          this.authService.setActiveEnvironment(this.selectedEnvironment)
            .subscribe(success => {
              if (success) {
                this.closeDialog();
              }
            });
        } catch (error) {
          this.notificationService.showError(`Failed to connect to ${this.selectedEnvironment.friendlyName}`);
        }
      } else {
        this.notificationService.showInfo(`Already connected to ${this.selectedEnvironment.friendlyName}`);
        this.closeDialog();
      }
      return;
    }
    
    if (this.environmentForm.invalid) {
      this.notificationService.showError('Please correct validation errors before connecting');
      return;
    }
    
    const environmentUrl = this.environmentForm.get('environmentUrl').value;
    const friendlyName = this.environmentForm.get('friendlyName').value;
    const newEnvironment = this.createEnvironmentModel(environmentUrl, friendlyName);
    const current = this._activeEnvironmentModel.value;

    if (!current || !isSameEnvironment(current, newEnvironment)) {
      try {
        this.authService.setActiveEnvironment(newEnvironment)
          .subscribe(success => {
            if (success) {
              this.closeDialog();
            }
          });
      } catch (error) {
        this.notificationService.showError(`Failed to connect to ${friendlyName}`);
      }
    } else {
      this.notificationService.showInfo(`Already connected to ${friendlyName}`);
      this.closeDialog();
    }
  }

  closeDialog() {
    this.dialogRef.close();
  }
  
  onEnvironmentSelected(environment: EnvironmentModel) {
    this.selectedEnvironment = environment;
    this.isFormActive = false;
    
    this.environmentForm.markAsPristine();
    this.environmentForm.setErrors(null);
  }
  
  setFormActive(active: boolean) {
    if (active) {
      this.selectedEnvironment = null;
      // Restore validators when form becomes active
    } else {
      // Clear errors when form inactive
      this.environmentForm.get('friendlyName').setErrors(null);
    }
    this.isFormActive = active;
    
    // Force revalidation of the form
    this.environmentForm.updateValueAndValidity();
  }
  
  checkFormFocus(event: FocusEvent) {
    setTimeout(() => {
      const activeElement = document.activeElement;
      const form = document.querySelector('form');
      
      if (!form?.contains(activeElement)) {
        this.isFormActive = false;
      }
    }, 0);
  }  
}
