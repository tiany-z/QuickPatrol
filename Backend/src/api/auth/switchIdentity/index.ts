import api from "../switch-identity/index.js";

export const aliasedApi = {
  ...api,
  routePath: "/api/auth/switchIdentity"
};

export default aliasedApi;
