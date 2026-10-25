const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000/api";


async function request(
  path,
  options = {}
) {
  const response =
    await fetch(
      `${API_BASE_URL}${path}`,
      {
        credentials: "include",
        headers: {
          "Content-Type":
            "application/json",
          ...(options.headers || {}),
        },
        ...options,
      }
    );

  const type =
    response.headers.get(
      "content-type"
    ) || "";

  const data =
    type.includes(
      "application/json"
    )
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    throw new Error(
      data?.message ||
        `Request failed: ${response.status}`
    );
  }

  return data;
}


async function upload(
  path,
  formData
) {
  const response =
    await fetch(
      `${API_BASE_URL}${path}`,
      {
        method: "POST",
        credentials: "include",
        body: formData,
      }
    );

  const type =
    response.headers.get(
      "content-type"
    ) || "";

  const data =
    type.includes(
      "application/json"
    )
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    throw new Error(
      data?.message ||
        `Request failed: ${response.status}`
    );
  }

  return data;
}


export const api = {

  auth: {
    login: (
      role,
      username,
      password
    ) =>
      request(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            role,
            username,
            password,
          }),
        }
      ),

    logout: () =>
      request(
        "/auth/logout",
        {
          method: "POST",
        }
      ),

    me: () =>
      request(
        "/auth/me"
      ),
  },


  health: () =>
    request("/health"),


  live: {

    me: () =>
      request(
        "/live/me"
      ),

    upload: (
      file,
      cameraId
    ) => {
      const form =
        new FormData();

      form.append(
        "video",
        file
      );

      form.append(
        "camera_id",
        cameraId
      );

      return upload(
        "/live/upload",
        form
      );
    },
  },


  cameras: {

    list: () =>
      request(
        "/cameras"
      ),

    get: (id) =>
      request(
        `/cameras/${encodeURIComponent(
          id
        )}`
      ),
  },


  hospitals: {

    list: () =>
      request(
        "/hospitals"
      ),

    create: (data) => request("/hospitals", {
      method: "POST", body: JSON.stringify(data),
    }),

    me: () =>
      request(
        "/hospitals/me"
      ),

    updateResources: (
      data
    ) =>
      request(
        "/hospitals/me/resources",
        {
          method: "PUT",
          body: JSON.stringify(
            data
          ),
        }
      ),

    history: () =>
      request(
        "/hospitals/me/history"
      ),

    available: () =>
      request(
        "/hospitals/available"
      ),

    updateAvailability: (hospitalId, data) =>
      request(`/hospitals/${encodeURIComponent(hospitalId)}/availability`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },


  incidents: {
mapIncidents: () =>
  request("/incidents/hospital/map-incidents"),

    list: () =>
      request(
        "/incidents"
      ),

    get: (id) =>
      request(
        `/incidents/${encodeURIComponent(
          id
        )}`
      ),

    pending: () =>
      request(
        "/incidents/hospital/pending"
      ),

    history: () =>
      request(
        "/incidents/hospital/history"
      ),

    stats: () =>
      request(
        "/incidents/hospital/stats"
      ),

    accept: (id) =>
      request(
        `/incidents/${encodeURIComponent(
          id
        )}/accept`,
        {
          method: "POST",
        }
      ),

    reject: (id) =>
      request(
        `/incidents/${encodeURIComponent(
          id
        )}/reject`,
        {
          method: "POST",
        }
      ),

    dispatch: (id) =>
      request(
        `/incidents/${encodeURIComponent(
          id
        )}/dispatch`,
        {
          method: "POST",
        }
      ),

    updateStatus: (
      id,
      status
    ) =>
      request(
        `/incidents/${encodeURIComponent(
          id
        )}/status`,
        {
          method: "PUT",
          body: JSON.stringify({
            status,
          }),
        }
      ),
  },


  dispatch: {
    recommendations: (incidentId) =>
      request(`/dispatch/incidents/${encodeURIComponent(incidentId)}/recommendations`),
    selectFacility: (incidentId, facilityId) => request(`/dispatch/incidents/${encodeURIComponent(incidentId)}/select-facility`, {
      method: "POST", body: JSON.stringify({ facility_id: facilityId }),
    }),
    roadNetwork: () => request("/dispatch/road-network"),
    saveRoadNetwork: (network) => request("/dispatch/road-network", {
      method: "PUT", body: JSON.stringify({ network }),
    }),
  },

  ambulances: {
    list: () => request("/ambulances"),
    register: (data) => request("/ambulances", { method: "POST", body: JSON.stringify(data) }),
    updateStatus: (id, status) => request(`/ambulances/${encodeURIComponent(id)}/status`, {
      method: "PUT", body: JSON.stringify({ status }),
    }),
  },

  ambulanceSim: {
    assignments: () => request("/ambulance-sim/assignments"),
    start: (id, data = {}) => request(`/ambulance-sim/${encodeURIComponent(id)}/start`, {
      method: "POST", body: JSON.stringify(data),
    }),
    position: (id, data) => request(`/ambulance-sim/${encodeURIComponent(id)}/position`, {
      method: "POST", body: JSON.stringify(data),
    }),
    arriveScene: (id) => request(`/ambulance-sim/${encodeURIComponent(id)}/arrive-scene`, { method: "POST" }),
    departScene: (id, data = {}) => request(`/ambulance-sim/${encodeURIComponent(id)}/depart-scene`, {
      method: "POST", body: JSON.stringify(data),
    }),
    complete: (id) => request(`/ambulance-sim/${encodeURIComponent(id)}/complete`, { method: "POST" }),
    track: (incidentId) => request(`/ambulance-sim/track/${encodeURIComponent(incidentId)}`),
  },

  engineering: {
    routingBenchmark: (source = "sample") => request(`/engineering/routing-benchmark?source=${encodeURIComponent(source)}`),
  },

  copilot: {
    explain: (payload) => request("/copilot/explain", { method: "POST", body: JSON.stringify(payload) }),
  },

  admin: {
    engineeringMetrics: () => request("/admin/engineering-metrics"),

    summary: (
      month
    ) =>
      request(
        `/admin/summary?month=${encodeURIComponent(
          month
        )}`
      ),
  },
};


export {
  API_BASE_URL,
};