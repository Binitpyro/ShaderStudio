#version 300 es

precision highp float;

// Uniforms
uniform mat4 u_mvp;
uniform vec3 u_color;

// Vertex input
in vec3 a_position;

// Vertex output
out vec3 v_position;

void main() {
  v_position = a_position;
  gl_Position = u_mvp * vec4(a_position, 1.0);
}

// Fragment shader
#ifdef FRAGMENT
in vec3 v_position;
out vec4 fragColor;

void main() {
  fragColor = vec4(u_color, 1.0);
}
#endif
