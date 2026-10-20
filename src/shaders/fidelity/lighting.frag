#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_clip;
out vec4 fragColor;
uniform sampler2D u_albedoTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_roughnessTex;  // metallic in .r
uniform sampler2D u_depthTex;
uniform sampler2D u_motionTex;
uniform sampler2D u_aoTex;
uniform mat4 u_invViewProj;
uniform int u_debugView;  // 0 none, 1 albedo, 2 normal, 3 roughness, 4 metallic, 5 depth, 6 motion
uniform float u_aoEnabled;
uniform int u_bgMode;     // 0 clear colour, 1 env map, 2 procedural sky
uniform vec3 u_bgColor;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
//#include env
//#include shadow
//#include lighting
//#include sky
void main() {
  vec4 albedo = texture(u_albedoTex, v_uv);
  vec4 nr = texture(u_normalTex, v_uv);
  float metal = texture(u_roughnessTex, v_uv).r;
  float depth = texture(u_depthTex, v_uv).r;
  vec2 motion = (texture(u_motionTex, v_uv).xy - 0.5) * 2.0;
  if (u_debugView == 1) { fragColor = vec4(albedo.rgb, 1.0); return; }
  if (u_debugView == 2) { fragColor = vec4(nr.xyz, 1.0); return; }
  if (u_debugView == 3) { fragColor = vec4(vec3(nr.a), 1.0); return; }
  if (u_debugView == 4) { fragColor = vec4(vec3(metal), 1.0); return; }
  if (u_debugView == 5) { fragColor = vec4(vec3(depth), 1.0); return; }
  if (u_debugView == 6) { fragColor = vec4(abs(motion) * 20.0, 0.0, 1.0); return; }
  if (depth >= 1.0) {
    vec3 dir = normalize(u_camForward + v_clip.x * u_camRight + v_clip.y * u_camUp);
    vec3 bg = u_bgColor;
    if (u_bgMode == 1) bg = envSample(dir);
    else if (u_bgMode == 2) bg = skyColor(dir);
    fragColor = vec4(bg, 1.0);
    return;
  }
  vec4 w = u_invViewProj * vec4(v_uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 P = w.xyz / w.w;
  vec3 N = normalize(nr.xyz * 2.0 - 1.0);
  float ao = u_aoEnabled > 0.5 ? texture(u_aoTex, v_uv).r : 1.0;
  fragColor = vec4(shade(albedo.rgb, P, N, nr.a, metal, ao), albedo.a);
}
