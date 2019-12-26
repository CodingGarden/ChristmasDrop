const urlParams = new URLSearchParams(window.location.search);

const tree = document.getElementById('tree');
const treeRect = tree.getBoundingClientRect();

if (!urlParams.get('snowflakes')) {
  document.querySelector('.snowflakes').remove();
}

let drops = [];
const users = {};
let ornaments = [];
const treeCenterX = window.innerWidth / 2;

function getCenterAndRadius(rectangle) {
  return {
    x: rectangle.x + (rectangle.width / 2),
    y: rectangle.y + (rectangle.height / 2),
    radius: Math.max(rectangle.height, rectangle.width) / 2,
  };;
}

const dropPrototype = {
  getLeft() {
    return this.position.x - this.element.clientWidth / 2;
  },
  getRight() {
    return this.position.x + this.element.clientWidth / 2;
  },
  getTop() {
    return this.position.y;
  },
  getBottom() {
    return this.position.y + this.element.clientHeight;
  },
  getCenter() {
    return {
      x: this.position.x,
      y: (this.getTop() + this.getBottom()) / 2,
    };
  },
  collidesWith(otherDrop) {
    const thisEmote = this.element.querySelector('.emote');
    const otherEmote = otherDrop.element.querySelector('.emote');
    const thisCircle = getCenterAndRadius(thisEmote.getBoundingClientRect());
    const otherCircle = getCenterAndRadius(otherEmote.getBoundingClientRect());
    const distSq = (thisCircle.x - otherCircle.x) * (thisCircle.x - otherCircle.x) + (thisCircle.y - otherCircle.y) * (thisCircle.y - otherCircle.y);
    const radSumSq = (thisCircle.radius + otherCircle.radius) ** 2;
    return distSq <= radSumSq;
  },
};

if (urlParams.get('loadExisting')) {
  const existingOrnaments = JSON.parse(localStorage.ornaments || '[]');
  
  existingOrnaments.forEach(({
    position,
    url,
    avatar = true
  }) => {
    const element = createDropElement('', url, true);
    const ornament = {
      __proto__: dropPrototype,
      element,
      done: true,
      url,
      velocity: {
        x: 0,
        y: 0,
      },
      position
    };
    ornaments.push(ornament);
    element.classList.add('ornament');
    document.body.appendChild(element);
    element.style.top = ornament.getTop() + 'px';
    element.style.left = ornament.getLeft() + 'px';
  });
}


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

function doDrop(username, url, avatar = false, testing = false) {
  if (users[username]) return;
  users[username] = true;
  const element = createDropElement(username, url, avatar);
  drops.push({
    __proto__: dropPrototype,
    username,
    element,
    avatar,
    url,
    velocity: {
      x: testing ? 0 : (Math.random() * 4) * (Math.random() > 0.5 ? -1 : 1),
      y: (Math.random() * 5) + 2
    },
    position: {
      x: testing ? window.innerWidth / 2 : Math.floor(Math.random() * window.innerWidth),
      y: element.clientHeight - 100
    }
  });
  document.body.appendChild(element);
}

function draw() {
  drops.forEach(drop => {
    if (drop.final) return;
    drop.element.style.top = drop.getTop() + 'px';
    drop.element.style.left = drop.getLeft() + 'px';
    if (drop.done) {
      drop.final = true;
    }
  });
}

function dropCollidedOrnaments(drop) {
  ornaments.forEach(ornament => {
    if (drop.collidesWith(ornament)) {
      ornament.element.classList.add('fall-off');
      ornament.element.addEventListener('animationend', () => {
        ornament.element.remove();
        ornaments = ornaments.filter(o => o !== ornament);
        localStorage.ornaments = JSON.stringify(ornaments);
      });
    }
  });
}

function clearOrnaments() {
  ornaments.forEach(ornament => {
    ornament.element.classList.add('fall-off');
    ornament.element.addEventListener('animationend', () => {
      ornament.element.remove();
    });
  });
  ornaments = [];
  localStorage.ornaments = '[]';
}

function update() {
  drops.forEach(drop => {
    if (drop.done) return;
    drop.position.x += drop.velocity.x;
    drop.position.y += drop.velocity.y;

    if (drop.getLeft() < 0) {
      drop.velocity.x = Math.abs(drop.velocity.x);
    } else if (drop.getRight() >= window.innerWidth) {
      drop.velocity.x = -Math.abs(drop.velocity.x);
    } else if (drop.getBottom() >= treeRect.top) {
      const triangleWidthAtY = treeRect.width * ((drop.position.y - treeRect.top) / treeRect.height);

      const hitRect = drop.getLeft() >= treeRect.left &&
        drop.getRight() <= treeRect.right &&
        Math.abs(drop.position.x - treeCenterX) < (triangleWidthAtY / 2) + 20;

      if (hitRect) {
        const nextX = drop.position.x + drop.velocity.x;
        if (drop.velocity.y === 0 || (Math.abs(nextX - treeCenterX) > (triangleWidthAtY / 2) + 20)) {
          drop.done = true;
          drop.element.classList.add('ornament');
          dropCollidedOrnaments(drop);
          ornaments.push(drop);
          localStorage.ornaments = JSON.stringify(ornaments.map(({
            avatar,
            position,
            url
          }) => ({
            position,
            url,
            avatar
          })));
          setTimeout(() => {
            drops = drops.filter(d => d !== drop);
          }, 1000);
          setTimeout(() => {
            users[drop.username] = false;
          }, 30000);
        } else {
          drop.velocity.y *= 0.8;
          if (drop.velocity.y <= 0.5) {
            drop.velocity.y = 0;
          }
        }
      } else if (drop.getBottom() >= window.innerHeight) {
        drop.velocity.y = 0;
        drop.velocity.x = 0;
        drop.position.y = window.innerHeight - drop.element.clientHeight;
        drop.done = true;
        drop.element.classList.add('done');
        setTimeout(() => {
          document.body.removeChild(drop.element);
          drops = drops.filter(d => d !== drop);
          users[drop.username] = false;
        }, 30000);
      }
    }
  });
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

for (let i = 0; i < 1; i++) {  
  doDrop('Alca', 'https://static-cdn.jtvnw.net/emoticons/v1/328626_SA/3.0', false, true);
}

gameLoop();

if (urlParams.get('channel')) {

  const client = new tmi.Client({
    debug: true,
    connection: {
      secure: true,
      reconnect: true
    },
    channels: [ urlParams.get('channel') ]
  });
  
  client.connect();
  
  client.on('message', (channel, tags, message, self) => {
    if (message.startsWith('!drop')) {
      const name = tags['display-name'] || tags.username;
      if (users[name]) return;
      if (tags.emotes) {
        const emoteIds = Object.keys(tags.emotes);
        const emoteId = emoteIds[Math.floor(Math.random() * emoteIds.length)];
        const url = `https://static-cdn.jtvnw.net/emoticons/v1/${emoteId}/3.0`;
        doDrop(name, url);
      } else {
        const emojis = twemoji.parse(message, {
          assetType: 'png'
        });
        if (emojis.length) {
          const emoji = emojis[Math.floor(Math.random() * emojis.length)];
          doDrop(name, emoji.url);
        } else {
          doDrop(name, 'https://static-cdn.jtvnw.net/emoticons/v1/1713818/3.0');
        }
      }
    }
  });  
}
