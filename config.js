module.exports = {
  server: {
    port: 3000,
    pollIntervalMs: 10_000,
    serviceTimeoutMs: 2_000,
    proxmoxTimeoutMs: 5_000,
    nodeExporterTimeoutMs: 5_000,
  },

  machines: [
    {
      name: "proxmox-dmz",
      type: "proxmox",
      host: "REPLACE_ME",        // e.g. "10.0.20.10"
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME", // paste from PVE UI
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006", // click the card name to open the PVE web UI
    },
    {
      name: "proxmox-internal",
      type: "proxmox",
      host: "REPLACE_ME",
      port: 8006,
      tokenId: "dashboard@pve!readonly",
      tokenSecret: "REPLACE_ME",
      rejectUnauthorized: false,
      primaryUrl: "https://REPLACE_ME:8006",
    },
    {
      name: "nas",
      type: "node_exporter",
      host: "REPLACE_ME",
      port: 9100,
      primaryUrl: "http://REPLACE_ME", // TrueNAS web UI
    },
  ],

  // Overlay clickable metadata onto auto-discovered guests. Each entry attaches a URL,
  // icon, and display label to a guest by (machine, guest name). Matched guests become
  // clickable rows in the UI that open the URL in a new tab.
  guestLinks: [
    // { machine: "proxmox-dmz",      guest: "mealie-lxc", url: "http://REPLACE_ME:9000",      icon: "mealie-light.svg" },
    // { machine: "proxmox-internal", guest: "plex-lxc",   url: "http://REPLACE_ME:32400/web", icon: "plex-light.svg"   },
    // { machine: "proxmox-internal", guest: "dashboard",  url: "http://REPLACE_ME:3000",      icon: "dashboard.svg"    },
  ],
};
