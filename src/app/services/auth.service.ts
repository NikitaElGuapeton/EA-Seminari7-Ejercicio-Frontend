import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, switchMap, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  LoginRequest,
  LoginResponse,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
  User,
} from '../models';



@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private baseUrl = `${environment.apiUrl}/auth`;

  // El access token solo vive en memoria: al recargar la página se pierde y se recupera con /auth/refresh
  private accessToken = signal<string | null>(null);

  // El usuario también se mantiene en memoria
  private currentUser = signal<User | null>(null);
  readonly user = this.currentUser.asReadonly();

  // computed: se recalculan solos cada vez que cambia el usuario
  readonly isLoggedIn = computed(() => this.currentUser() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.role === 'admin');

  /** POST /auth/register. No inicia sesión: la API no devuelve token y hay que hacer login */
  register(data: RegisterRequest): Observable<RegisterResponse> {
    // Permite que el navegador gestione cookies HttpOnly en las rutas de autenticación.
    return this.http.post<RegisterResponse>(`${this.baseUrl}/register`, data, {
      withCredentials: true,
    });
  }

  /** POST /auth/login. Si va bien, guarda el access token y el usuario en memoria */
  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/login`, credentials, {
      withCredentials: true,
    }).pipe(
      // tap: hago algo con la respuesta sin cambiarla; el componente la sigue recibiendo igual
      tap((response) => {
        // El access token se conserva solo en memoria para que JavaScript no lo persista en el navegador
        this.accessToken.set(response.token);
        this.currentUser.set(response.user);
      }),
    );
  }

  /** POST /auth/refresh. El navegador envía la cookie y el access token renovado se guarda en memoria */
  refresh(): Observable<string> {
    return this.http
      .post<RefreshResponse>(`${this.baseUrl}/refresh`, {}, { withCredentials: true })
      .pipe(
        tap(({ token }) => this.accessToken.set(token)),
        map(({ token }) => token),
      );
  }

    /** Recupera la sesión y el usuario al iniciar la aplicación */
  initializeSession(): Observable<void> {
    return this.refresh().pipe(
      switchMap(() =>
        this.http.get<User>(`${this.baseUrl}/me`, { withCredentials: true }),
      ),
      tap((user) => this.currentUser.set(user)),
      map(() => undefined),
      catchError((error: HttpErrorResponse) => {
        if (error.status !== 401) {
          return throwError(() => error);
        }

        // Si no hay una sesión válida, la aplicación empieza sin usuario ni access token
        this.accessToken.set(null);
        this.currentUser.set(null);
        return of(undefined);
      }),
    );
  }

  /** Pide al backend que borre la cookie y limpia siempre la sesión local */
  logout(): void {
    this.http
      .post<void>(`${this.baseUrl}/logout`, {}, { withCredentials: true })
      .pipe(
        // Aunque falle la petición, el frontend olvida el token y el usuario
        finalize(() => {
          this.accessToken.set(null);
          this.currentUser.set(null);
          void this.router.navigate(['/login']);
        }),
      )
      .subscribe({
        error: (error: unknown) => {
          console.error('No se pudo completar el cierre de sesión', error);
        },
      });
  }

  /** Devuelve el access token en memoria para que el interceptor lo use en Authorization */
  getToken(): string | null {
    return this.accessToken();
  }
}
