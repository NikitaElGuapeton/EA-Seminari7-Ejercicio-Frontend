import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';

// Mensaje con el que la API responde 401 cuando el access token ha caducado (ver el contrato en LOGS.md)
const TOKEN_EXPIRED = 'El token ha caducado';

// Las peticiones son inmutables: para añadir una cabecera se hace una copia con clone()
function withToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

// Un interceptor se ejecuta en TODAS las peticiones de HttpClient, entre el servicio y la red.
// Este hace dos cosas, para que ningún servicio tenga que preocuparse del token:
//   1. Añade la cabecera Authorization: Bearer <token>.
//   2. Si la API responde 401 porque el token ha caducado, pide uno nuevo con la cookie
//      y repite la petición. Si no se puede renovar, cierra la sesión (lleva al login).
export const authInterceptor: HttpInterceptorFn = (request, next) => {

  const auth = inject(AuthService);
  const token = auth.getToken();

  const isAuthRoute = request.url.startsWith(`${environment.apiUrl}/auth/`);
  const isCurrentUserRequest = request.url === `${environment.apiUrl}/auth/me`;

  // Login, registro, refresh y logout usan la cookie; /auth/me necesita el access token
  if (isAuthRoute && !isCurrentUserRequest) {
    return next(request);
  }

  return next(token ? withToken(request, token) : request).pipe(
    catchError((error: HttpErrorResponse) => {
      // Cualquier error que no sea 401 lo dejo pasar tal cual al componente
      if (error.status !== 401) {
        return throwError(() => error);
      }

      // Si el 401 ocurre porque el access token ha caducado, intentamos renovarlo con la cookie
      if (error.error?.message === TOKEN_EXPIRED) {
        return auth.refresh().pipe(
          // Si el refresh falla (la cookie también expiró), cerramos la sesión completamente
          catchError((refreshError) => {
            auth.logout();
            return throwError(() => refreshError);
          }),
          // switchMap: cuando llega el token nuevo, lanzo otra vez la petición con él
          switchMap((newToken) => next(withToken(request, newToken))),
        );
      }

      // Cualquier otro 401 (sin token, token falso...) quiere decir que no hay sesión válida
      auth.logout();
      return throwError(() => error);
    }),
  );
};
