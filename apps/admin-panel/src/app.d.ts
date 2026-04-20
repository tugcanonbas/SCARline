declare global {
  namespace App {
    interface Locals {
      accessToken: string | null;
      refreshToken: string | null;
      apiBase: string;
    }

    interface PageData {
      user: {
        sub: string;
        username: string;
        roles: string[];
        displayName: string;
      } | null;
      isAuthenticated: boolean;
      docsUrl?: string;
    }
  }
}

export {};
