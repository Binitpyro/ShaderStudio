#version 300 es
precision highp float;
in vec2 v_clip;
out vec4 fragColor;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
//#include sky
void main() {
  vec3 dir = normalize(u_camForward + v_clip.x * u_camRight + v_clip.y * u_camUp);
  fragColor = vec4(skyColor(dir), 1.0);
}
