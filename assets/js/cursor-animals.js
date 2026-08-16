(() => {
	const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	if (!canHover.matches || reducedMotion.matches) return;

	const sprites = ['squirrel', 'penguin', 'fox', 'rabbit', 'duck', 'red-panda'];
	const spacing = 32;
	const pointer = { x: -100, y: -100 };
	let active = false;
	let cursorVisible = false;
	let animationFrame = 0;
	let facing = 1;

	const animals = sprites.map(name => {
		const image = document.createElement('img');
		image.className = 'cursor-animal';
		image.src = `assets/images/cursor-animals/${name}.gif`;
		image.alt = '';
		image.setAttribute('aria-hidden', 'true');
		document.body.appendChild(image);
		return {
			element: image,
			x: pointer.x,
			y: pointer.y,
		};
	});

	function showAnimals() {
		animals.forEach(animal => animal.element.classList.add('is-visible'));
	}

	function hideAnimals() {
		animals.forEach(animal => animal.element.classList.remove('is-visible'));
	}

	function canAnimate() {
		return active
			&& cursorVisible
			&& !document.hidden
			&& !document.documentElement.classList.contains('lg-on');
	}

	function stopAnimals() {
		if (animationFrame) cancelAnimationFrame(animationFrame);
		animationFrame = 0;
		hideAnimals();
	}

	function startAnimals() {
		if (!canAnimate() || animationFrame) return;
		showAnimals();
		animationFrame = requestAnimationFrame(animate);
	}

	function animate(time) {
		animationFrame = 0;
		if (!canAnimate()) {
			hideAnimals();
			return;
		}

		let leaderX = pointer.x;
		let leaderY = pointer.y;

		animals.forEach((animal, index) => {
			const deltaX = leaderX - animal.x;
			const deltaY = leaderY - animal.y;
			const distance = Math.hypot(deltaX, deltaY);

			if (distance > spacing) {
				const targetX = leaderX - (deltaX / distance) * spacing;
				const targetY = leaderY - (deltaY / distance) * spacing;
				animal.x += (targetX - animal.x) * 0.42;
				animal.y += (targetY - animal.y) * 0.42;
			}

			const bob = Math.sin(time / 260 + index) * 2;
			animal.element.style.transform = `translate3d(${animal.x - 17.5}px, ${animal.y - 17.5 + bob}px, 0) scaleX(${facing})`;
			leaderX = animal.x;
			leaderY = animal.y;
		});
		animationFrame = requestAnimationFrame(animate);
	}

	document.addEventListener('pointermove', event => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		cursorVisible = true;
		const movementX = event.clientX - pointer.x;
		if (active && Math.abs(movementX) > 1) facing = movementX > 0 ? 1 : -1;
		pointer.x = event.clientX;
		pointer.y = event.clientY;

		if (!active) {
			active = true;
			animals.forEach((animal, index) => {
				animal.x = pointer.x - (index + 1) * spacing;
				animal.y = pointer.y;
			});
		}
		startAnimals();
	}, { passive: true });

	document.documentElement.addEventListener('mouseleave', () => {
		cursorVisible = false;
		stopAnimals();
	});
	document.documentElement.addEventListener('mouseenter', () => {
		cursorVisible = true;
		startAnimals();
	});
	window.addEventListener('blur', () => {
		cursorVisible = false;
		stopAnimals();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) stopAnimals();
		else startAnimals();
	});

	new MutationObserver(() => {
		if (document.documentElement.classList.contains('lg-on')) stopAnimals();
		else startAnimals();
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	});

	window.addEventListener('pagehide', stopAnimals, { once: true });
})();
