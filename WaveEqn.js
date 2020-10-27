/**
 * Copyright 2018, 2020 - M. Lamoureux 
 *
 */
function WaveEngine(gpgpUtility_, xResolution_, yResolution_, xLength_, yLength_, dt_)
{
  "use strict";

  // we duplicate the input variables. Don't know if this is necessary.
  var gpgpUtility = gpgpUtility_;
  var xResolution = xResolution_; // number of grid points in the x direction
  var yResolution = yResolution_; // number of grid points in the y direction
  var xLength = xLength_;  // length of x side, in meters
  var yLength = yLength_;  // length of y side, in meters
  var dt = dt_; // time step size, in seconds

  // spatial steps for the finite difference code
  var dx    = xLength/xResolution;
  var dy    = yLength/yResolution;

  // pointers to the offsets in the Laplace stencil, including diagonal and anti-diagonals
  var ndxHandle;
  var ndyHandle;
  var nddHandle;
  var ndaHandle;
  // weights for the Laplace stencil, note the diagonal and antidiagonal weights are equal. So only store one.
  var wt0Handle;
  var wtxHandle;
  var wtyHandle;
  var wtdHandle;
  // Pointer to the wave function at t, and t - dt
  var waveFunctionHandle; 
  var oldWaveFunctionHandle;
  // WebGLRenderingContext
  var gl;
  // a frame buffer object
  var fbos;
  var step = 0;  // count mode 3, to identify which textures are the time source, which is the destination
  // stuff for gpgpUtilities
  var positionHandle;
  var program;
  var textureCoordHandle;
  var textures;

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
                         // waveFunction.r is the amplitude waveFunction.g is the velocity^2. At time t.
                         + "uniform sampler2D waveFunction;"
                         // oldWaveFunction.r is the amplitude oldWaveFunction.g is the velocity^2. At time t-dt.
                         + "uniform sampler2D oldWaveFunction;"
                         + ""
                         // The displacement in normalized x direction, y direction, diagonal and anti-diagonal.
                         // These are 2-vectors.
                         + "uniform vec2 ndx;"
                         + "uniform vec2 ndy;"
                         + "uniform vec2 ndd;"
                         + "uniform vec2 nda;"
                         + ""
                         // The weights needed in the Laplacian stencil wtx = (dt*dt)/(dx*dx).
                         + "uniform float wt0;"
                         + "uniform float wtx;"
                         + "uniform float wty;"
                         + "uniform float wtd;"
                         + ""
                         // A pointer into the Texture structure
                         + "varying vec2 vTextureCoord;"
                         + ""
                         + "void main()"
                         + "{"
                         + "  gl_FragColor.g = texture2D(waveFunction, vTextureCoord).g;" // carry over the veolcity^2 variable
                         + "  gl_FragColor.r = "  // and this is the time step on the wave amplitude
                         + "     2.0*texture2D(waveFunction, vTextureCoord).r "
                         + "     - texture2D(oldWaveFunction,vTextureCoord).r "
                         + "     + (gl_FragColor.g)*(  "
                         + "       wt0 * "
                         + "       (texture2D(waveFunction, vTextureCoord).r)"
                         + "       + "
                         + "       wtx * "
                         + "       (texture2D(waveFunction,vTextureCoord+ndx).r + texture2D(waveFunction,vTextureCoord-ndx).r)"
                         + "       + "
                         + "       wty * "
                         + "       (texture2D(waveFunction,vTextureCoord+ndy).r + texture2D(waveFunction,vTextureCoord-ndy).r)"
                         + "       + "
                         + "       wtd * " // use the fact that wtd = wta usually, to save an operation here
                         + "       (texture2D(waveFunction,vTextureCoord+ndd).r + texture2D(waveFunction,vTextureCoord-ndd).r "
                         + "          + "
                         + "        texture2D(waveFunction,vTextureCoord+nda).r + texture2D(waveFunction,vTextureCoord-nda).r)"
                         + "      );" 
                         + "}";

    program               = gpgpUtility.createProgram(null, fragmentShaderSource);
    positionHandle        = gpgpUtility.getAttribLocation(program,  "position");
    gl.enableVertexAttribArray(positionHandle);
    textureCoordHandle    = gpgpUtility.getAttribLocation(program,  "textureCoord");
    gl.enableVertexAttribArray(textureCoordHandle);
    //set up our pointers to variables in the shader code
    waveFunctionHandle    = gl.getUniformLocation(program, "waveFunction");
    oldWaveFunctionHandle = gl.getUniformLocation(program, "oldWaveFunction");
    ndxHandle              = gl.getUniformLocation(program, "ndx");
    ndyHandle              = gl.getUniformLocation(program, "ndy");
    nddHandle              = gl.getUniformLocation(program, "ndd");
    ndaHandle              = gl.getUniformLocation(program, "nda");
    wt0Handle              = gl.getUniformLocation(program, "wt0");
    wtxHandle              = gl.getUniformLocation(program, "wtx");
    wtyHandle              = gl.getUniformLocation(program, "wty");
    wtdHandle              = gl.getUniformLocation(program, "wtd");

    return program;
  };

  /**
   * Setup the initial values for textures. Two for values of the wave function,
   * and a third as a render target.
   */
  this.setInitialTextures = function(texture0, texture1, texture2)
  {
    textures[0] = texture0;
    fbos[0]     = gpgpUtility.attachFrameBuffer(texture0);
    textures[1] = texture1;
    fbos[1]     = gpgpUtility.attachFrameBuffer(texture1);
    textures[2] = texture2;
    fbos[2]     = gpgpUtility.attachFrameBuffer(texture2);
  }

  /**
   * Set the potential as a texture
   */
  this.setPotential = function(texture)
  {
    potential = texture;
  }

  /**
   * Runs the program to do the actual work. On exit the framebuffer &amp;
   * texture are populated with the next timestep of the wave function.
   * You can use gl.readPixels to retrieve texture values.
   */
  this.timestep = function()
  {
    var gl;

    gl = gpgpUtility.getComputeContext();

    gl.useProgram(program);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[(step+2)%3]);

    gpgpUtility.getStandardVertices();

    gl.vertexAttribPointer(positionHandle,     3, gl.FLOAT, gl.FALSE, 20, 0);
    gl.vertexAttribPointer(textureCoordHandle, 2, gl.FLOAT, gl.FALSE, 20, 12);

    // Here we insert values from this JS code into the shader code above
    gl.uniform2f(ndxHandle,          1.0/xResolution ,0.0); // this is a 2-vector
    gl.uniform2f(ndyHandle,          0.0, 1.0/yResolution); // this is a 2-vector
    gl.uniform2f(nddHandle,          1.0/xResolution, 1.0/yResolution); // this is a 2-vector
    gl.uniform2f(ndaHandle,         -1.0/xResolution, 1.0/yResolution); // this is a 2-vector
    // Here is from our work on grid algebras
    var gamma = 1/3;  // circularly symmetric in dx=dy case. Not sure about other cases
    var lambda = dx*dx/(dy*dy);
    var eps = dt*dt/(dx*dx)
    // we pre-compute the weights in the Laplacian stencil, to speed up the shaders (PDE solver)
    gl.uniform1f(wt0Handle,          eps*(-2+2*gamma-2*lambda));
    gl.uniform1f(wtxHandle,          eps*(1-gamma));
    gl.uniform1f(wtyHandle,          eps*(lambda - gamma));
    gl.uniform1f(wtdHandle,          eps*gamma/2);
   
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[step]);
    gl.uniform1i(oldWaveFunctionHandle, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures[(step+1)%3]);
    gl.uniform1i(waveFunctionHandle, 2);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Step cycles though 0, 1, 2
    // Controld cycling over old, current and render target uses of textures
    step = (step+1)%3;
  };

  /**
   * Retrieve the most recently rendered to texture.
   *
   * @returns {WebGLTexture} The texture used as the rendering target in the most recent
   *                         timestep.
   */
  this.getRenderedTexture = function()
  {
      return textures[(step+1)%3];
  }

  /**
   * Retrieve the two frambuffers that wrap the textures for the old and current wavefunctions in the
   * next timestep. Render to these FBOs in the initialization step.
   *
   * @returns {WebGLFramebuffer[]} The framebuffers wrapping the source textures for the next timestep.
   */
  this.getSourceFramebuffers = function()
  {
    var value = [];
    value[0] = fbos[step];
    value[1] = fbos[(step+1)%3];
    return value;
  }

  /**
   * Retrieve the two textures for the old and current wave functions in the next timestep.
   * Fill these with initial values for the wave function.
   *
   * @returns {WebGLTexture[]} The source textures for the next timestep.
   */
  this.getSourceTextures     = function()
  {
    var value = [];
    value[0] = textures[step];
    return value;
  }

  /**
   * Invoke to clean up resources specific to this program. We leave the texture
   * and frame buffer intact as they are used in followon calculations.
   */
  this.done = function ()
  {
    gl.deleteProgram(program);
  };

  gl          = gpgpUtility.getGLContext();
  program     = this.createProgram(gl);
  fbos        = new Array(3);  // I think this needs to be 3, not 2
  textures    = new Array(3);  // I think this needs to be 3, not 2
//  step        = 0;
//  dx    = xLength/xResolution;
//  dy    = yLength/yResolution;
//  hx = (dt*dt)/(dx*dx);
//  hy = (dt*dt)/(dy*dy);
};