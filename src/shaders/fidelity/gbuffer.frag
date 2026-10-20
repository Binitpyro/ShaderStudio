#version 300 es
precision highp float;
in vec3 v_world;
in vec4 v_cur;
in vec4 v_prev;
// G-buffer layout (MRT): 0 albedo.rgb | 1 normal.xyz*0.5+0.5, roughness | 2 metallic.r | 3 motion.xy*0.5+0.5 (uv delta)
layout(location = 0) out vec4 o_albedo;
layout(location = 1) out vec4 o_normal;
layout(location = 2) out vec4 o_material;
layout(location = 3) out vec4 o_motion;
uniform vec3 u_color;
uniform vec3 u_camPos;
uniform float u_roughness;
uniform float u_metallic;
void main() {
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  if (dot(n, u_camPos - v_world) < 0.0) n = -n;
  vec2 motion = (v_cur.xy / v_cur.w - v_prev.xy / v_prev.w) * 0.5;
  o_albedo = vec4(u_color, 1.0);
  o_normal = vec4(n * 0.5 + 0.5, u_roughness);
  o_material = vec4(u_metallic, 0.0, 0.0, 1.0);
  o_motion = vec4(motion * 0.5 + 0.5, 0.0, 1.0);
}
