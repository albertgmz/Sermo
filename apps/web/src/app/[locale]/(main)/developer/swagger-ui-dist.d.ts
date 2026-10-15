// The prebuilt ES bundle of Swagger UI ships without types. Only what the reference uses is
// declared.
declare module "swagger-ui-dist/swagger-ui-es-bundle.js" {
  interface TryItRequest {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }
  interface SwaggerUIConfig {
    domNode: HTMLElement;
    spec: object;
    presets: unknown[];
    deepLinking: boolean;
    docExpansion: "list" | "full" | "none";
    filter: boolean;
    validatorUrl: string | null;
    persistAuthorization: boolean;
    withCredentials: boolean;
    requestInterceptor: (request: TryItRequest) => TryItRequest;
  }
  interface SwaggerUIBundle {
    (config: SwaggerUIConfig): unknown;
    presets: { apis: unknown };
  }
  const SwaggerUIBundle: SwaggerUIBundle;
  export default SwaggerUIBundle;
}
