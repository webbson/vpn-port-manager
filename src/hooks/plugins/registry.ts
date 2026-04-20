export interface HookPluginFieldDescriptor {
  name: string;
  label: string;
  placeholder?: string;
  help?: string;
  required?: boolean;
  type?: "text" | "password";
}

export interface HookPluginDescriptor {
  id: string;
  label: string;
  description: string;
  fields: HookPluginFieldDescriptor[];
}

export const hookPluginDescriptors: HookPluginDescriptor[] = [
  {
    id: "plex",
    label: "Plex",
    description:
      "Update Plex's manually-specified port whenever the VPN port changes.",
    fields: [
      {
        name: "host",
        label: "Plex server URL",
        placeholder: "http://plex.lan:32400",
        help: "Include scheme and port. Must be reachable from inside this container.",
        required: true,
      },
      {
        name: "token",
        label: "X-Plex-Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxx",
        type: "password",
        required: true,
        help:
          "In the Plex web UI: play any item → \u2026 (More) → Get Info → View XML. " +
          "Copy the X-Plex-Token= value from the URL that opens. " +
          "Guide: https://support.plex.tv/articles/204059436",
      },
    ],
  },
];

export function getHookPluginDescriptor(id: string): HookPluginDescriptor | undefined {
  return hookPluginDescriptors.find((d) => d.id === id);
}
