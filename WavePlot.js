/**
 * Copyright 2018 M. Lamoureux
 */

/**
 * Given a 2D texture containing amplitudes of a 2D wave (in the red component)
 * plot them onto the canvas. Blue color is positive, red is negative. 
 */
function WaveResults(gpgpUtility_, parent_, xResolution_, yResolution_)
{
  "use strict";

  // don't know if I need this, copying the input variables
  var gpgpUtility  = gpgpUtility_;
  var parent       = parent_;
  var xResolution  = xResolution_;
  var yResolution  = yResolution_;
  var positionHandle;
  var program;
  var waveFunction;
  var waveFunctionHandle;
  var maxVelHandle;
  var textureCoordHandle;
 
  /**
   * Compile shaders and link them into a program, then retrieve references to the
   * attributes and uniforms. The standard vertex shader, which simply passes on the
   * physical and texture coordinates, is used.
   *
   * @returns {WebGLProgram} The created program object.
   * @see {https://www.khronos.org/registry/webgl/specs/1.0/#5.6|WebGLProgram}
   */
  this.createProgram = function (gl)
  {
    var fragmentShaderSource;
    var program;

    // Note that the preprocessor requires the newlines.
    fragmentShaderSource = "#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
                         + "precision highp float;\n"
                         + "#else\n"
                         + "precision mediump float;\n"
                         + "#endif\n"
                         + ""
                         // waveFunction.r is the real part waveFunction.g is the imaginary part.
                         + "uniform sampler2D waveFunction;"
                         + ""
                         // maximum velocity^2 to normalize to.
                         + "uniform float maxVel;"
                         + ""
                         // pointer into the textuer
                         + "varying vec2 vTextureCoord;"
                         + ""
                         + "void main()"
                         + "{"
                         + "  float  amp;" // wave amplitude
                         + "  float  vel;" // velocity value
                         + ""
                         + "  amp     = texture2D(waveFunction, vTextureCoord).r;"
                         + "  vel     = texture2D(waveFunction, vTextureCoord).g;"
                         + ""
                         + "  gl_FragColor = max(0., amp)*vec4(0.,0.,1.,1.)"
                         + "               + max(0.,-amp)*vec4(1.,0.,0.,1.)"
                         + "               + min(1.,vel/maxVel)*vec4(0.,1.,0.,1.);"  // add a green tint for velocity
                         + "}";

    program            = gpgpUtility.createProgram(null, fragmentShaderSource);
    positionHandle     = gpgpUtility.getAttribLocation(program,  "position");
    gl.enableVertexAttribArray(positionHandle);
    textureCoordHandle = gpgpUtility.getAttribLocation(program,  "textureCoord");
    gl.enableVertexAttribArray(textureCoordHandle);
    waveFunctionHandle = gl.getUniformLocation(program, "waveFunction");
    maxVelHandle = gl.getUniformLocation(program, "maxVel");
    return program;
  };

  /**
   * Setup for rendering to the screen. Create a canvas, get a rendering context,
   * set uniforms.
   */
  this.setup = function(gpgpUtility)
  {
    var gl;
    gl = gpgpUtility.getGLContext();

    gl.useProgram(program);

  }

  /**
   * Map the waveFunction texture onto a curve
   *
   * @param waveFunction {WebGLTexture} A xResolution by 1 texture containing the real
   *                                    and imaginary parts of the wave function.
   */
  this.show = function(waveFunction,maxV)
  {
    var blending;
    var gl;

    gl = gpgpUtility.getRenderingContext();

    gl.uniform1f(maxVelHandle, maxV); // push this value before running the program for shaders

    gl.useProgram(program);

 
     blending = gl.isEnabled(gl.BLEND);
    if (!blending)
    {
      gl.enable(gl.BLEND);
    }

    // This time we will render to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gpgpUtility.getStandardVertices();

    gl.vertexAttribPointer(positionHandle,     3, gl.FLOAT, gl.FALSE, 20, 0);
    gl.vertexAttribPointer(textureCoordHandle, 2, gl.FLOAT, gl.FALSE, 20, 12);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, waveFunction);
    gl.uniform1i(waveFunctionHandle, 0);
// here
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!blending)
    {
      gl.disable(gl.BLEND);
    }
  }
  // now run the damn thing  
  program  = this.createProgram(gpgpUtility.getGLContext());
  this.setup(gpgpUtility);

}