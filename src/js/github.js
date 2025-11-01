// This file fetches and displays GitHub repositories using data from repos.json

fetch('../data/repos.json')
    .then(response => response.json())
    .then(data => {
        const repoContainer = document.getElementById('repo-container');
        data.forEach(repo => {
            const repoElement = document.createElement('div');
            repoElement.classList.add('repo');
            repoElement.innerHTML = `
                <h3><a href="${repo.url}" target="_blank">${repo.name}</a></h3>
                <p>${repo.description}</p>
            `;
            repoContainer.appendChild(repoElement);
        });
    })
    .catch(error => console.error('Error fetching repositories:', error));