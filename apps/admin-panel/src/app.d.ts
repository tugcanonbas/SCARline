declare global {
  namespace App {
    type Role = 'admin' | 'researcher' | 'operator' | 'observer';
    interface AuthenticatedUser {
      id: string;
      username: string;
      roles: Role[];
      displayName: string;
      passwordResetRequired?: boolean;
    }
    interface Locals {
      accessToken: string | null;
      apiBase: string;
      publicApiBase: string;
      webSocketOrigin: string;
    }
    interface PageData {
      user: AuthenticatedUser | null;
      isAuthenticated: boolean;
      docsUrl?: string;
      publicApiBase?: string;
      webSocketOrigin?: string;
    }
  }
}

export {};
