import { clearSessionTokens, DELETED_SESSION_KEY } from "./session-storage";
jest.mock("../config/api-config", () => ({
  API_BASE_URL: "https://vc6.test",
}));

import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import * as SecureStore from "expo-secure-store";
import { api, ACCESS_TOKEN_KEY, backgroundApi, REFRESH_TOKEN_KEY } from "./api";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

interface Vault {
  [key: string]: string | undefined;
}

function installVault(initial: Vault): Vault {
  const vault: Vault = { ...initial };

  mockedSecureStore.getItemAsync.mockImplementation(
    async (key: string) => vault[key] ?? null,
  );

  mockedSecureStore.setItemAsync.mockImplementation(
    async (key: string, value: string) => {
      vault[key] = value;
    },
  );

  mockedSecureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    delete vault[key];
  });

  return vault;
}

function okResponse(config: InternalAxiosRequestConfig): AxiosResponse {
  return {
    data: { ok: true },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  };
}

function unauthorized(config: InternalAxiosRequestConfig) {
  return {
    name: "AxiosError",
    isAxiosError: true,
    message: "Request failed with status code 401",
    config,
    response: {
      data: {},
      status: 401,
      statusText: "Unauthorized",
      headers: {},
      config,
    },
  };
}

describe("backgroundApi", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("attaches the persisted access token on a headless request", async () => {
    installVault({
      [ACCESS_TOKEN_KEY]: "access-123",
      [REFRESH_TOKEN_KEY]: "refresh-123",
    });

    let authorization: unknown;

    await backgroundApi.get("/journey/fixes", {
      adapter: async (config) => {
        authorization = config.headers.Authorization;
        return okResponse(config);
      },
    });

    expect(authorization).toBe("Bearer access-123");
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("refreshes a background 401, persists rotated tokens, and retries once", async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: "expired-access",
      [REFRESH_TOKEN_KEY]: "refresh-old",
    });

    const refreshPost = jest.spyOn(axios, "post").mockResolvedValue({
      data: {
        accessToken: "access-new",
        refreshToken: "refresh-new",
      },
    } as Awaited<ReturnType<typeof axios.post>>);

    let attempts = 0;
    const seenAuthorization: unknown[] = [];

    const adapter: AxiosAdapter = async (config) => {
      attempts += 1;
      seenAuthorization.push(config.headers.Authorization);

      if (attempts === 1) {
        return Promise.reject(unauthorized(config));
      }

      return okResponse(config);
    };

    const response = await backgroundApi.get("/journey/fixes", { adapter });

    expect(response.status).toBe(200);
    expect(attempts).toBe(2);

    expect(seenAuthorization).toEqual([
      "Bearer expired-access",
      "Bearer access-new",
    ]);

    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(refreshPost).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/refresh$/),
      { refreshToken: "refresh-old" },
    );

    expect(vault[ACCESS_TOKEN_KEY]).toBe("access-new");
    expect(vault[REFRESH_TOKEN_KEY]).toBe("refresh-new");

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("retains credentials when background refresh fails", async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: "expired-access",
      [REFRESH_TOKEN_KEY]: "refresh-dead",
    });

    jest
      .spyOn(axios, "post")
      .mockRejectedValue(new Error("refresh unavailable"));

    const adapter: AxiosAdapter = async (config) =>
      Promise.reject(unauthorized(config));

    await expect(
      backgroundApi.get("/journey/fixes", { adapter }),
    ).rejects.toThrow("refresh unavailable");

    expect(vault[ACCESS_TOKEN_KEY]).toBe("expired-access");
    expect(vault[REFRESH_TOKEN_KEY]).toBe("refresh-dead");

    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("does not loop if the retried request also returns 401", async () => {
    installVault({
      [ACCESS_TOKEN_KEY]: "expired-access",
      [REFRESH_TOKEN_KEY]: "refresh-loop",
    });

    const refreshPost = jest.spyOn(axios, "post").mockResolvedValue({
      data: {
        accessToken: "access-new",
        refreshToken: "refresh-new",
      },
    } as Awaited<ReturnType<typeof axios.post>>);

    let attempts = 0;

    const adapter: AxiosAdapter = async (config) => {
      attempts += 1;
      return Promise.reject(unauthorized(config));
    };

    await expect(
      backgroundApi.get("/journey/fixes", { adapter }),
    ).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(attempts).toBe(2);
    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("stops calling /auth/refresh once the server has rejected the token", async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: "expired-access",
      [REFRESH_TOKEN_KEY]: "refresh-revoked",
    });

    const refreshPost = jest.spyOn(axios, "post").mockRejectedValue({
      name: "AxiosError",
      isAxiosError: true,
      message: "Request failed with status code 401",
      response: {
        data: {},
        status: 401,
        statusText: "Unauthorized",
      },
    });

    const adapter: AxiosAdapter = async (config) =>
      Promise.reject(unauthorized(config));

    await expect(
      backgroundApi.get("/journey/fixes", { adapter }),
    ).rejects.toMatchObject({ response: { status: 401 } });

    await expect(
      backgroundApi.get("/journey/fixes", { adapter }),
    ).rejects.toThrow("Background refresh token was previously rejected");

    /*
     * BATTERY, NOT CORRECTNESS. Durable rows are retained either way. But a
     * dead refresh token must not mean two network calls per TaskManager
     * delivery, every ~10 seconds, for the length of an emergency.
     *
     * Delete the rejectedBackgroundRefreshToken guard in api.ts and this
     * goes red at 2.
     */
    expect(refreshPost).toHaveBeenCalledTimes(1);

    expect(vault[ACCESS_TOKEN_KEY]).toBe("expired-access");
    expect(vault[REFRESH_TOKEN_KEY]).toBe("refresh-revoked");
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
describe("foreground credential/session separation", () => {
  it.each(["/auth/login", "/auth/password-reset/confirm"])(
    "never refreshes a rejected %s credential",
    async (path) => {
      installVault({
        [ACCESS_TOKEN_KEY]: "synthetic-stale-access",
        [REFRESH_TOKEN_KEY]: "synthetic-refresh",
      });
      const refresh = jest.spyOn(axios, "post");
      await expect(
        api.post(
          path,
          {},
          { adapter: async (config) => Promise.reject(unauthorized(config)) },
        ),
      ).rejects.toMatchObject({ response: { status: 401 } });
      expect(refresh).not.toHaveBeenCalled();
      expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
    },
  );
  it("bounds foreground refresh and retries the protected request once", async () => {
    installVault({ [REFRESH_TOKEN_KEY]: "synthetic-refresh" });
    const refresh = jest
      .spyOn(axios, "post")
      .mockResolvedValue({ data: { accessToken: "synthetic-new" } });
    let attempts = 0;
    await api.get("/users/me", {
      adapter: async (config) =>
        ++attempts === 1
          ? Promise.reject(unauthorized(config))
          : okResponse(config),
    });
    expect(refresh).toHaveBeenCalledWith(
      "https://vc6.test/auth/refresh",
      { refreshToken: "synthetic-refresh" },
      { timeout: 10000 },
    );
    expect(attempts).toBe(2);
  });
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
});

describe("account deletion session boundary", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });
  it("allows explicit new login but blocks authenticated and headless requests after deletion", async () => {
    installVault({
      [DELETED_SESSION_KEY]: "deleted:owner",
      [ACCESS_TOKEN_KEY]: "old-access",
    });
    let authorization: unknown;
    await api.post(
      "/auth/login",
      { email: "new@example.test", password: "password" },
      {
        adapter: async (config) => {
          authorization = config.headers.Authorization;
          return okResponse(config);
        },
      },
    );
    expect(authorization).toBeUndefined();
    const adapter = jest.fn(async (config: InternalAxiosRequestConfig) =>
      okResponse(config),
    );
    await expect(api.get("/users/me", { adapter })).rejects.toThrow(
      "session changed",
    );
    await expect(
      backgroundApi.get("/journey/fixes", { adapter }),
    ).rejects.toThrow("session changed");
    expect(adapter).not.toHaveBeenCalled();
  });
  it.each([api, backgroundApi])(
    "does not persist or retry a refresh response that arrives after deletion",
    async (client) => {
      const vault = installVault({
        [ACCESS_TOKEN_KEY]: "expired",
        [REFRESH_TOKEN_KEY]: "refresh-old",
      });
      let resolve!: (data: Awaited<ReturnType<typeof axios.post>>) => void;
      let started!: () => void;
      const refreshing = new Promise<void>((r) => {
        started = r;
      });
      jest.spyOn(axios, "post").mockImplementation(() => {
        started();
        return new Promise((r) => {
          resolve = r;
        });
      });
      const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => {
        throw unauthorized(config);
      });
      const outcome = client
        .get("/protected", { adapter })
        .catch((error) => error);
      await refreshing;
      await clearSessionTokens("owner");
      resolve({
        data: { accessToken: "late-access", refreshToken: "late-refresh" },
      } as Awaited<ReturnType<typeof axios.post>>);
      expect(await outcome).toBeInstanceOf(Error);
      expect(vault[ACCESS_TOKEN_KEY]).toBeUndefined();
      expect(vault[REFRESH_TOKEN_KEY]).toBeUndefined();
      expect(adapter).toHaveBeenCalledTimes(1);
    },
  );
  it("does not refresh or log out the user when the deletion endpoint fails with 401", async () => {
    const vault = installVault({
      [ACCESS_TOKEN_KEY]: "access",
      [REFRESH_TOKEN_KEY]: "refresh",
    });
    const post = jest.spyOn(axios, "post");
    await expect(
      api.delete("/auth/account", {
        adapter: async (config) => {
          throw unauthorized(config);
        },
      }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(post).not.toHaveBeenCalled();
    expect(vault[ACCESS_TOKEN_KEY]).toBe("access");
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
