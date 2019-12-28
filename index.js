import config from './config.js';

// ES2017 Math please
if (!Math.clamp) Math.clamp = (val, min, max) => Math.min(max, Math.max(val, min));

// from underscore.js
function debounce(func, wait, immediate) {
	let timeout;
	return function() {
		const context = this, args = arguments;
		let later = function() {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		const callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
};

const
  // Draw collision boxes
  debug = true,

  // Drop up to this many pixels from the left/right edges:
  dropEdgeIn = 100,
  // Thickness of collision safety box around the world:
  safetyBox = 400,

  gravity = 0.005,
  airResistanceF = 0.1,

   // Each drop has a random +ve vertical speed limit (fake air resistance)
  randomVY = () => Math.random() * 5 + 3;

let treeRect, treeCenterX, worldSize, quadTree;
const
  drops = new Set(),
  users = {},
  ornaments = new Set(),
  tree = document.getElementById('tree');

// Tree svg sometimes loads slowly:
const onTreeResize = () => {
  treeRect = tree.getBoundingClientRect();
  treeCenterX = (treeRect.left + treeRect.right) / 2;
};
new ResizeObserver(entries => {
  onTreeResize();
}).observe(tree);

const onWorldResize = () => {
  console.log('*** World resized');
  worldSize = {width: window.innerWidth, height: window.innerHeight};
  onTreeResize();
  let oldQuadTree = quadTree;
  quadTree = new Quadtree({
    width: worldSize.width,
    height: worldSize.height,
    maxElements: 4, // Performance tuning
  });
  if (oldQuadTree) oldQuadTree.each((drop) => quadTree.push(drop));
};
onWorldResize(); // Invoke immediately and whenever window resizes:
window.addEventListener('resize', debounce(onWorldResize, 250, true));

/**
 * Real position is (centerX, centerY) used for CSS
 * All others are just calculated
 * x, y is top left and used by quadtree collision detection
 */
const dropPrototype = {
  recalcSize() {
    /* Need to scale by ornament CSS transform: scale factor */
    this.width = (this.__ornament ? 0.8 * this.CRwidth : this.CRwidth) || 0;
    this.height = (this.__ornament ? 0.8 * this.CRheight : this.CRheight) || 0;
    this.x = this.left;
    this.y = this.top;
  },
  set ornament(ornament) {
    this.__ornament = ornament;
    this.recalcSize(); // emote shrunk/grew, we need to update the collision width/size
  },
  get ornament() {
    return this.__ornament;
  },
  get centerX() {
    return this.__centerX;
  },
  set centerX(val) {
    this.__centerX = val;
    this.x = this.left;
  },
  get centerY() {
    return this.__centerY;
  },
  set centerY(val) {
    this.__centerY = val;
    this.y = this.top;
  },
  get left() {
    return this.centerX - this.width / 2;
  },
  get right() {
    return this.centerX + this.width / 2;
  },
  get top() {
    return this.centerY - this.height/2;
  },
  get bottom() {
    return this.centerY + this.height/2;
  },
  get radius() {
    return Math.max(this.width, this.height) / 2;
  },
  getCenterAndRadius() {
    return {
      x: this.centerX,
      y: this.centerY,
      radius: Math.max(this.width, this.height) / 2,
    };
  },
  /**
   * Update this.width, height when emote element size changes
   * To handle size changes during load, non-square emote etc
   */
  bindElementRect() {
    this.width = 0;
    this.height = 0;
    const thisEmote = this.element.querySelector('.emote');
    new ResizeObserver(entries => {
      for (const entry of entries) {
        if(entry.contentRect) {
          this.CRwidth = entry.contentRect.width;
          this.CRheight = entry.contentRect.height;
          this.recalcSize();
        }
      }
    }).observe(thisEmote);
  },
  collidesWithRadius(other) {
    return (this.centerX - other.centerX)**2 + (this.centerY - other.centerY)**2 <= (this.radius + other.radius) ** 2;
  },
  /**
   * Modifies velocity of this and other to simulate a collision
   * 
   * Based on a "correct" elastic collision but also:
   *  - bias the mass so the lower drop is always heavier, causing physically impossible but fun results
   *  - avoid repeated collisions within a given timeframe
   *  - apply an "outthrust" force to push overlapping drops apart
   *  - cap resulting downward velocities (fake air resistance)
   * 
   * @param {*} other drop we're colliding with
   * @param {*} frameQ frametime scale factor
   * @param {*} timestamp current timestamp
   * @param {*} elasticCollisionTimes Map of previous elastic collisions by timestamp
   */
  elasticCollisionWith(other, frameQ, timestamp, elasticCollisionTimes) {
    const repeatCollisionMS = 100; // The same two flakes can collide every X ms
    const biasLower = 4; // bottom flake is this times heavier
    const outthrustFactor = 0.8;

    const mThis = this.centerY > other.centerY ? biasLower : 1;
    const mOther = this.centerY <= other.centerY ? biasLower : 1;
    const sThis = (2 * mOther) / (mThis + mOther);
    const sOther = (2 * mThis) / (mThis + mOther);

    const distSq = (this.centerX - other.centerX)**2 + (this.centerY - other.centerY)**2;
    const dist = Math.sqrt(distSq);
    const overlapFactor = Math.clamp(dist / (this.radius + other.radius), 0, 1)

    const thrustScale = 1 - 0.8 * overlapFactor;

    const vnThrust = {
      x: ((this.centerX - other.centerX) / dist) * frameQ * thrustScale * outthrustFactor,
      y: ((this.centerY - other.centerY) / dist) * frameQ * thrustScale * outthrustFactor,
    };

    let vnThis, vnOther;

    if ((elasticCollisionTimes.get(`${this.id},${other.id}`)||0) > timestamp || (elasticCollisionTimes.get(`${other.id},${this.id}`)||0) > timestamp) {
      // Recently did an elastic collision, just apply outthrust force
      vnThis = {
        x: this.velocity.x + vnThrust.x,
        y: this.velocity.y + vnThrust.y,
      };
      vnOther = {
        x: other.velocity.x - vnThrust.x,
        y: other.velocity.y - vnThrust.y,
      };
    } else { // Elastic collision:
      elasticCollisionTimes.set(`${this.id},${other.id}`, timestamp + repeatCollisionMS);
      // console.log(`Elastic collision between ${this.id} and ${other.id}`);
      const dotThis = (this.velocity.x - other.velocity.x)*(this.centerX - other.centerX) + (this.velocity.y - other.velocity.y)*(this.centerY - other.centerY);
      const dotOther = (other.velocity.x - this.velocity.x)*(other.centerX - this.centerX) + (other.velocity.y - this.velocity.y)*(other.centerY - this.centerY);
      vnThis = {
        x: this.velocity.x - sThis * (dotThis / distSq) * (this.centerX - other.centerX) + vnThrust.x,
        y: this.velocity.y - sThis * (dotThis / distSq) * (this.centerY - other.centerY) + vnThrust.y,
      };
      vnOther = {
        x: other.velocity.x - sOther * (dotOther / distSq) * (other.centerX - this.centerX) - vnThrust.x,
        y: other.velocity.y - sOther * (dotOther / distSq) * (other.centerY - this.centerY) - vnThrust.x,
      };
    }

    // Cap the +ve vertical components to the "air resistance"
    vnThis.y = Math.min(vnThis.y, this.maxV);
    vnOther.y = Math.min(vnOther.y, other.maxV);

    this.velocity = vnThis;
    other.velocity = vnOther;
  },
};


function createDropElement(name, url, avatar) {
  const dropElement = document.createElement('div');
  dropElement.classList.add('drop');
  const snowflakeNum = Math.floor(Math.random() * 3) + 1;
  dropElement.innerHTML = `
    <p class="name">
      <span>${name}</span>
    </p>
    <img class="snowflake-bg" src="images/snowflake-${snowflakeNum}.svg" />
    <img class="emote ${avatar ? 'avatar' : ''}" src="${url}" />
  `;
  return dropElement;
}

let dropID = 0; // generate unique drop ID
const createDrop = (username, url, avatar, centerX, centerY, isOrnament=false, vX=0, vY=0) => {
  const drop = {
    __proto__: dropPrototype,
    id: ++dropID,
    username,
    element : createDropElement(username, url, avatar),
    avatar,
    url,
    velocity: {
      x: vX,
      y: vY,
    },
    maxV: randomVY(), // Max (+ve vertical) velocity
    width: 0,
    height: 0,
  };
  drop.maxVSQ = drop.maxV ** 2;
  drop.centerX = centerX; // Explicitly trigger the property setter
  drop.centerY = centerY;
  if (isOrnament) {
    drop.done = true
    drop.element.style.left = drop.centerX + 'px';
    drop.element.style.top = drop.centerY + 'px';
    ornaments.add(drop);
    drop.element.classList.add('ornament');
    drop.ornament = true; // Trigger resize calculation
  } else {
    drops.add(drop)
  }
  document.body.appendChild(drop.element);
  drop.bindElementRect();
  quadTree.push(drop, true);
  return drop;
};

// Load existing ornaments:
const existingOrnaments = JSON.parse(localStorage.ornaments || '[]');
existingOrnaments.forEach(({position, url, avatar = true}) => {
  createDrop('', url, true, position.x, position.y, true);
});

function doDrop(username, url, avatar = false, testing = false) {
  // if (users[username]) return;
  users[username] = true;
  createDrop(username, url, avatar,
    testing ? treeCenterX : dropEdgeIn + Math.floor(Math.random() * (worldSize.width - 2 * dropEdgeIn)), -100 - (Math.random() * 200),
    false,
    testing ? 0 : (Math.random() * 4) * (Math.random() > 0.5 ? -1 : 1), randomVY());
}

function draw() {
  for (const drop of drops) {
    if (drop.final) return;
    drop.element.style.left = drop.centerX + 'px';
    drop.element.style.top = drop.centerY + 'px';
    if (drop.done) {
      drop.final = true;
    }
  }
}

function dropCollidedOrnaments(drop) {
  const potentiallyCollidingOrnaments = quadTree.colliding(drop);
  let changedOrnaments = false;
  for (const ornament of potentiallyCollidingOrnaments) {
    if (!ornament.done) continue;
    if (drop.collidesWithRadius(ornament)) {
      quadTree.remove(ornament);
      ornaments.delete(ornament);
      changedOrnaments = true;

      ornament.element.classList.add('fall-off');
      ornament.element.addEventListener('animationend', () => {
        ornament.element.remove();
      });
    }
  }
  if (changedOrnaments) saveOrnaments();
}

function clearOrnaments() {
  for (const ornament of ornaments) {
    quadTree.remove(ornament);
    ornament.element.classList.add('fall-off');
    ornament.element.addEventListener('animationend', () => {
      ornament.element.remove();
    });
  }
  ornaments.clear();
  localStorage.ornaments = '[]';
}

function saveOrnaments() {
  localStorage.ornaments = JSON.stringify([...ornaments.values()].map(({
    avatar,
    centerX,
    centerY,
    url,
  }) => ({
    position: {x: centerX, y: centerY},
    url,
    avatar
  })));
}

/**
 * Records times of last elastic collisions.
 * Periodically cleaned up by collisionGC() to avoid growing too large (N^2!)
 */
const elasticCollisionTimes = new Map();

function update(frameTimeMS, timestamp) {
  /**
   * frameQ: multiply time-dependent values by this to scale them as if the game were locked to 60fps
   */
  const maxFrameTime = 1000 / 20; // Cap to min 20fps to prevent collision bugs
  const frameQ = Math.min(frameTimeMS, maxFrameTime) * 0.06;

  // Update velocities:
  for (const drop of drops) {
    if (drop.done) continue;
    drop.centerX += drop.velocity.x * frameQ;
    drop.centerY += drop.velocity.y * frameQ;
  }

  const notColliding = debug ? new Set([...ornaments, ...drops]) : null; // for debug outlines

  // Catch any crazy collisions flying out the top:
  for (const drop of quadTree.colliding({
    x: -safetyBox,
    y: -2 * safetyBox,
    width: worldSize.width + 2 * safetyBox,
    height: safetyBox,
  })) {
    if (drop.done) continue;
    if (debug) {
      drop.element.classList.add('collisiondebug');
      notColliding.delete(drop);
    }
    if (drop.velocity.y < 0) {
      // console.log(`Hit safety box X:${drop.x | 0} y:${drop.y |0} vx:${drop.velocity.x | 0} vy:${drop.velocity.y | 0}`);
      drop.velocity.x = 0;
      drop.velocity.y = 0;
    }
  }

  // Colliding with ground:
  for (const drop of quadTree.colliding({
    x: -safetyBox,
    y: worldSize.height,
    width: worldSize.width + 2 * safetyBox,
    height: safetyBox,
  })) {
    if (drop.done) continue;

    if (debug) {
      drop.element.classList.add('collisiondebug');
      notColliding.delete(drop);
    }

    quadTree.remove(drop);
    drops.delete(drop);

    drop.velocity.y = 0;
    drop.velocity.x = 0;
    // drop.y = worldSize.height - drop.height;
    drop.element.classList.add('done');
    drop.done = true;

    drop.element.addEventListener('animationend', () => {
      drop.element.remove();
    });
    
    setTimeout(() => {
      users[drop.username] = false;
    }, 30000);
  }

  // Left edge:
  for (const drop of quadTree.colliding({
    x: -50,  // Note: because of an edge case with the quadtree left edge,
    y: -safetyBox,    // actually find all boxes 50 away from the wall
    width: safetyBox,
    height: worldSize.height + 2 * safetyBox,
  })) {
    if (drop.done) continue;
    if (drop.x > 0) continue; // Only ones actually touching the wall
    if (debug) {
      drop.element.classList.add('collisiondebug');
      notColliding.delete(drop);
    }
    drop.velocity.x = Math.abs(drop.velocity.x);
  }

  // Right edge:
  for (const drop of quadTree.colliding({
    x: worldSize.width,
    y: -safetyBox,
    width: safetyBox,
    height: worldSize.height + 2 * safetyBox,
  })) {
    if (drop.done) continue;
    if (debug) {
      drop.element.classList.add('collisiondebug');
      notColliding.delete(drop);
    }
    drop.velocity.x = -Math.abs(drop.velocity.x);
  }

  const noGravity = new Set();
  let changedOrnaments = false; // Do we need to overwrite local storage?

  // Tree collision:
  for (const drop of quadTree.colliding({
    x: treeRect.left,
    y: treeRect.top,
    width: treeRect.width,
    height: treeRect.height,
  })) {
    if (drop.done) continue;
    const triangleHeighFrac = Math.clamp((drop.centerY - treeRect.top) / treeRect.height, 0, 1);
    const triangleWidthAtY = Math.max(treeRect.width * triangleHeighFrac, drop.radius);
    const dropDistanceY = Math.abs(drop.centerX - treeCenterX);

    if (dropDistanceY < triangleWidthAtY) {
      // Colliding with tree:
      if (debug) {
        drop.element.classList.add('collisiondebug');
        notColliding.delete(drop);
      }
      noGravity.add(drop); // Gravity doesn't affect drops sliding around in the tree

      dropCollidedOrnaments(drop);
      const sf  = (1 - (dropDistanceY / triangleWidthAtY) ** 2); // seems to get a even ornament distribution
      drop.velocity.y *= 1 - 0.1 * frameQ * sf;
      
      if (Math.abs(drop.velocity.y) <= 0.5) {
        drop.velocity.y = 0;
        drop.velocity.x = 0;

        drop.done = true;
        drop.element.classList.add('ornament');
        drop.ornament = true;
        ornaments.add(drop);
        changedOrnaments = true;
        drops.delete(drop);
        setTimeout(() => {
          users[drop.username] = false;
        }, 30000);
      }
    }
  }
  if (changedOrnaments) saveOrnaments();

  // Drop-to-drop midair collisions:
  const dropDropCollisions = new Set();
  for (const drop of drops) {
    if (drop.done) continue;
    for (const dropOther of quadTree.colliding(drop)) {
      if (dropOther.done) continue;

      // If we checked A->B collision, skip checking B->A
      if (dropDropCollisions.has(`${drop.id},${dropOther.id}`) || dropDropCollisions.has(`${dropOther.id},${drop.id}`)) continue;
      dropDropCollisions.add(`${drop.id},${dropOther.id}`);

      // Radius check:
      if (!drop.collidesWithRadius(dropOther)) continue;
      if (debug) {
        dropOther.element.classList.add('collisiondebug');
        drop.element.classList.add('collisiondebug');
        notColliding.delete(drop);
        notColliding.delete(dropOther);
      }

      drop.elasticCollisionWith(dropOther, frameQ, timestamp, elasticCollisionTimes);
    }
  }
  

  if (debug) {
    for (const drop of notColliding) {
      drop.element.classList.remove('collisiondebug');
    }
  }

  for (const drop of drops) {
    if (drop.done) continue;
     // Gravity
    if (!noGravity.has(drop)) drop.velocity.y += gravity * frameQ;
    // Air resistance effect:
    if (drop.velocity.y > 0 && drop.velocity.x ** 2 + drop.velocity.y ** 2 > drop.maxVSQ) {
      drop.velocity.y *= 1 - airResistanceF * frameQ;
      drop.velocity.x *= 1 - airResistanceF * frameQ;
    }
  }
}

let lastTimestamp, debugInfo;
function gameLoop(timestamp) {
  const frameTime = timestamp - lastTimestamp;
  update(frameTime, timestamp);
  draw();
  if (debug) {
    debugInfo.textContent = `FPS: ${(1000 / frameTime).toFixed(0).padStart(3, ' ')}   QuadTree: ${quadTree.size.toString().padStart(4, ' ')}`;
  }
  requestAnimationFrame(gameLoop);
  lastTimestamp = timestamp;
}

requestAnimationFrame((timestamp) => {
  lastTimestamp = timestamp;
  draw();
  if (debug) {
    debugInfo = document.createElement('pre');
    debugInfo.classList.add('debug-info');
    document.body.appendChild(debugInfo);
  }
  setInterval(collisionGC, 20000);
  requestAnimationFrame(gameLoop);
});

const collisionGC = () => {
  // let gcCount = 0;
  for (const [key, time] of elasticCollisionTimes) {
    if (time < (lastTimestamp || 0)) {
      elasticCollisionTimes.delete(key);
      // gcCount++;
    }
  }
  // if (gcCount) console.log(`Cleaned up ${gcCount} entries`);
};

for (let i = 0; i < 100; i++) {  
  doDrop('Rick Astley', 'https://i.giphy.com/media/gfxeFtolrd4fLhTaEg/giphy.webp', true, false);
}

let liveChatId = new Date().toLocaleDateString();

(async () => {
  const socket = io(config.messageServer);
  liveChatId = await fetch(`${config.messageServer}/streams`)
    .then(res => res.json())
    .then(([event]) => {
      if (event) {
        return event.snippet.liveChatId;
      }
      return new Date().toLocaleDateString();
    });

  socket.on(`messages/${liveChatId}`, (messages) => {
    messages.forEach(message => {
      if (message.message.startsWith('!clear') && message.author.isChatOwner) {
        clearOrnaments();
      }
      if (message.message.startsWith('!drop')) {
        const username = message.author.displayName;
        if (users[username]) return;
        const args = message.message.split(' ');
        args.shift();
        const arg = args.length ? args[0].trim() : '';
        const emojis = twemoji.parse(arg, {
          assetType: 'png'
        });
        if (emojis.length) {
          const emoji = emojis[Math.floor(Math.random() * emojis.length)];
          doDrop(username, emoji.url);
        } else if (arg === 'me') {
          doDrop(username, message.author.profileImageUrl, true);
        } else {
          const emoteMatches = arg.match(/!\[\]\((.*)\)/);
          if (emoteMatches && emoteMatches[1].startsWith('http')) {
            doDrop(username, emoteMatches[1]);
          } else {
            if (message.platform === 'twitch') {
              doDrop(username, 'https://static-cdn.jtvnw.net/emoticons/v1/1713818/3.0');
            } else {
              doDrop(username, 'https://i.imgur.com/rDtKBbG.png');
            }
          }
        }
      }
    });
  });
})();